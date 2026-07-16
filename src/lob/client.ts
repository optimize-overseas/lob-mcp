/**
 * Thin fetch-based HTTP client for the Lob.com REST API.
 *
 * Carries TWO Basic-auth headers — one per key. Every request is classified into
 * exactly one operation kind, which decides both the default key and whether the
 * call is allowed at all:
 *   • preview — /resource_proofs (any method). Always the TEST key: proofs are a
 *     test-account artifact of the preview→commit flow. Never billed, never
 *     refused.
 *   • commit — a billable POST (matches BILLABLE_POST_PATHS) → env.effectiveCommitMode
 *     ("live" only when LOB_LIVE_API_KEY AND LOB_LIVE_MODE=true). In test mode it
 *     runs against the test account (a $0 test send), so the send flow still works.
 *   • read — a GET, or a pure-lookup POST (address verification / autocompletion /
 *     identity — matches READ_LIKE_POST_PATHS). No state change and no physical-mail
 *     spend (verifications are metered lookups, but carry no live-account or mail
 *     risk) → env.effectiveReadMode ("live" whenever LOB_LIVE_API_KEY is configured,
 *     unless LOB_READS_USE_TEST=true), so "how many letters last week?" sees live data.
 *   • mutation — anything else: a DELETE, a cancel, an update (PATCH/PUT/POST to an
 *     existing resource) or a non-billable create (templates, campaigns, creatives,
 *     webhooks, addresses, bank accounts, inventory). These CHANGE account state, so
 *     they are FAIL-CLOSED: refused before any network call unless LOB_LIVE_MODE is
 *     enabled. Without this gate a `live_` key present in the environment would let a
 *     delete/cancel/update reach the LIVE account while the server believed it was in
 *     test mode. When live mode IS on, mutations route to the live key.
 *
 * An explicit `keyMode` still overrides the chosen KEY, but it does NOT bypass the
 * mutation gate — the fail-closed refusal is a function of the operation and the
 * live-mode posture only.
 *
 * Asserts at runtime that any POST to a billable create path carries an
 * Idempotency-Key. This is a programmer-error guard for the preview/commit
 * helper — the assertion fires before any network call.
 */
import { loadEnv, type LobEnv } from "../env.js";
import { USER_AGENT } from "../version.js";
import {
  LobApiError,
  LobMcpError,
  LobMcpErrorCodes,
  LobTimeoutError,
  type LobErrorBody,
} from "./errors.js";

export interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  idempotencyKey?: string | undefined;
  /** Send body as multipart/form-data instead of JSON. Lob requires this for some endpoints. */
  asForm?: boolean;
  /** Override the Lob-Version header for this request only. */
  lobVersion?: string | undefined;
  /**
   * test = use test key. live = use live key when configured (else falls back to test).
   * Default: env.effectiveCommitMode for billable POSTs; env.effectiveReadMode otherwise.
   */
  keyMode?: "test" | "live";
}

/**
 * Billable mail-piece / inventory-order POST paths. These always require an
 * Idempotency-Key and are gated by commit mode (test in test mode = a $0 test send).
 *
 * ⚠️ ANY new POST endpoint that SENDS physical mail (or otherwise incurs Lob spend)
 * MUST be added here. If it is left to the `mutation` default arm instead, it is
 * fail-closed in test mode (good) but in LIVE mode would route to the live key and
 * send real mail WITHOUT the idempotency-key assertion, piece cap, or preview→commit
 * gating — all of which hang off the `commit` class, not `mutation`.
 */
const BILLABLE_POST_PATHS: RegExp[] = [
  /^\/postcards\b/,
  /^\/letters\b/,
  /^\/self_mailers\b/,
  /^\/checks\b/,
  /^\/buckslips\/[^/]+\/orders\b/,
  /^\/cards\/[^/]+\/orders\b/,
];

/**
 * Proof endpoints. Proofs are produced by the preview step against the TEST key,
 * so every operation on one (create/get/update) is exercised against the test
 * account too — regardless of read/commit mode — and is never treated as a
 * live-account mutation.
 */
const PROOF_PATHS: RegExp[] = [/^\/resource_proofs\b/];

/**
 * POST paths that are pure lookups: they read reference data and do not mutate
 * the account or bill for physical mail (address verification, autocompletion,
 * identity validation). Routed like reads, never gated as mutations.
 */
const READ_LIKE_POST_PATHS: RegExp[] = [
  /^\/us_verifications\b/,
  /^\/intl_verifications\b/,
  /^\/us_autocompletions\b/,
  /^\/bulk\/us_verifications\b/,
  /^\/bulk\/intl_verifications\b/,
  /^\/identity_validation\b/,
];

type OperationClass = "preview" | "commit" | "read" | "mutation";

/**
 * Classify a request into exactly one operation kind from its method + path.
 *
 * The default arm is `mutation`: any DELETE / PATCH / PUT, and any POST that is
 * not a billable send, a proof, or a pure lookup, changes account state. Keeping
 * mutation the DEFAULT (rather than an allow-list of known-destructive paths)
 * means a newly added state-changing tool is fail-closed automatically — it
 * cannot silently fall through to the read key.
 */
export function classifyOperation(method: string, path: string): OperationClass {
  if (PROOF_PATHS.some((rx) => rx.test(path))) return "preview";
  if (method === "POST" && BILLABLE_POST_PATHS.some((rx) => rx.test(path))) {
    return "commit";
  }
  if (method === "GET") return "read";
  if (method === "POST" && READ_LIKE_POST_PATHS.some((rx) => rx.test(path))) {
    return "read";
  }
  return "mutation";
}

export class LobClient {
  readonly env: LobEnv;
  private readonly testAuth: string;
  private readonly liveAuth: string | null;

  constructor(env?: LobEnv) {
    this.env = env ?? loadEnv();
    this.testAuth =
      "Basic " + Buffer.from(`${this.env.testApiKey}:`, "utf8").toString("base64");
    this.liveAuth = this.env.liveApiKey
      ? "Basic " + Buffer.from(`${this.env.liveApiKey}:`, "utf8").toString("base64")
      : null;
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const opClass = classifyOperation(opts.method, opts.path);

    if (opClass === "commit" && !opts.idempotencyKey) {
      throw new Error(
        `Idempotency-Key required for POST ${opts.path}. This is a programmer bug — every billable ` +
          "create path must pass an idempotency key (use buildPreviewCommit or pass explicitly).",
      );
    }

    // Fail-closed live-mutation gate: a state-changing operation never reaches
    // the network unless the server is explicitly in live mode. This runs before
    // key selection, so an explicit `keyMode` cannot bypass it.
    if (opClass === "mutation" && !this.env.liveModeEnabled) {
      throw new LobMcpError(
        LobMcpErrorCodes.LIVE_MODE_REQUIRED,
        `Refused: ${opts.method} ${opts.path} changes Lob account state (a delete, cancel, ` +
          `update, or non-billable create), which is disabled while the server is in test mode.`,
        "Set LOB_LIVE_MODE=true (with a live_ key) to perform destructive or mutating Lob operations.",
      );
    }

    // Key selection. Previews and (test-mode) commits use the test key; reads
    // follow read mode; a permitted mutation follows commit mode (which is "live"
    // exactly when live mode is enabled, the only way we reach this arm).
    let defaultMode: "test" | "live";
    switch (opClass) {
      case "preview":
        defaultMode = "test";
        break;
      case "commit":
      case "mutation":
        defaultMode = this.env.effectiveCommitMode;
        break;
      case "read":
        defaultMode = this.env.effectiveReadMode;
        break;
    }
    const requestedMode = opts.keyMode ?? defaultMode;
    const auth =
      requestedMode === "live" && this.liveAuth ? this.liveAuth : this.testAuth;

    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    const version = opts.lobVersion ?? this.env.apiVersion;
    if (version) headers["Lob-Version"] = version;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let body: BodyInit | undefined;
    if (opts.body !== undefined && opts.method !== "GET" && opts.method !== "DELETE") {
      if (opts.asForm) {
        body = toFormData(opts.body);
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
    }

    // Per-request AbortController: each call gets its own signal so a slow
    // request can't abort siblings, and the timer is always cleared on settle.
    const controller = new AbortController();
    const timeoutMs = this.env.requestTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LobTimeoutError(opts.path, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const requestId = res.headers.get("x-request-id") ?? undefined;
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      // Body read can also abort if the response stalls between headers and body.
      if (controller.signal.aborted) {
        throw new LobTimeoutError(opts.path, timeoutMs);
      }
      throw err;
    }
    const json = text ? safeParse(text) : undefined;

    if (!res.ok) {
      const errBody = json as LobErrorBody | undefined;
      const message = errBody?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new LobApiError({
        status: res.status,
        message,
        code: errBody?.error?.code,
        requestId,
        body: json ?? text,
      });
    }
    return (json as T) ?? (undefined as T);
  }

  private buildUrl(path: string, query: Record<string, unknown> | undefined): string {
    const url = new URL(this.env.baseUrl + (path.startsWith("/") ? path : "/" + path));
    if (query) appendQuery(url.searchParams, query);
    return url.toString();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function appendQuery(params: URLSearchParams, query: Record<string, unknown>, prefix = ""): void {
  for (const [rawKey, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
    if (Array.isArray(value)) {
      for (const v of value) params.append(`${key}[]`, String(v));
    } else if (typeof value === "object") {
      appendQuery(params, value as Record<string, unknown>, key);
    } else {
      params.append(key, String(value));
    }
  }
}

function toFormData(body: unknown): FormData {
  const fd = new FormData();
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      appendForm(fd, k, v);
    }
  }
  return fd;
}

function appendForm(fd: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendForm(fd, `${key}[]`, item);
  } else if (typeof value === "object" && !(value instanceof Blob)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendForm(fd, `${key}[${k}]`, v);
    }
  } else {
    fd.append(key, value instanceof Blob ? value : String(value));
  }
}
