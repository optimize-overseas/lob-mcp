/**
 * Thin fetch-based HTTP client for the Lob.com REST API.
 *
 * Carries TWO Basic-auth headers — one per key. Callers pick which key to use via
 * `keyMode: "test" | "live"`. When the caller does not supply one, the client
 * picks based on the operation kind:
 *   • Billable POST (matches BILLABLE_POST_PATHS) → env.effectiveCommitMode
 *     ("live" only when LOB_LIVE_API_KEY AND LOB_LIVE_MODE=true).
 *   • Everything else (lists, gets, cancels, deletes, non-billable creates,
 *     verifications) → env.effectiveReadMode ("live" whenever LOB_LIVE_API_KEY
 *     is configured, unless LOB_READS_USE_TEST=true). Reads have no billing
 *     risk and "how many letters last week?" is almost always about live data.
 *
 * Previews always pass `keyMode: "test"` so the proof endpoint runs against the
 * test key regardless of either mode.
 *
 * Asserts at runtime that any POST to a billable create path carries an
 * Idempotency-Key. This is a programmer-error guard for the preview/commit
 * helper — the assertion fires before any network call.
 */
import { loadEnv, type LobEnv } from "../env.js";
import { USER_AGENT } from "../version.js";
import { LobApiError, LobTimeoutError, type LobErrorBody } from "./errors.js";

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

/** POST paths that always require an Idempotency-Key header. */
const BILLABLE_POST_PATHS: RegExp[] = [
  /^\/postcards\b/,
  /^\/letters\b/,
  /^\/self_mailers\b/,
  /^\/checks\b/,
  /^\/buckslips\/[^/]+\/orders\b/,
  /^\/cards\/[^/]+\/orders\b/,
];

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
    const isBillablePost =
      opts.method === "POST" &&
      BILLABLE_POST_PATHS.some((rx) => rx.test(opts.path));

    if (isBillablePost && !opts.idempotencyKey) {
      throw new Error(
        `Idempotency-Key required for POST ${opts.path}. This is a programmer bug — every billable ` +
          "create path must pass an idempotency key (use buildPreviewCommit or pass explicitly).",
      );
    }

    const defaultMode = isBillablePost
      ? this.env.effectiveCommitMode
      : this.env.effectiveReadMode;
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
