import { loadEnv, type LobEnv } from "../env.js";
import { LobApiError, type LobErrorBody } from "./errors.js";

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
}

export class LobClient {
  readonly env: LobEnv;
  private readonly authHeader: string;

  constructor(env?: LobEnv) {
    this.env = env ?? loadEnv();
    this.authHeader =
      "Basic " + Buffer.from(`${this.env.apiKey}:`, "utf8").toString("base64");
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
      "User-Agent": "lob-mcp/0.1.0",
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

    const res = await fetch(url, { method: opts.method, headers, body });
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
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
