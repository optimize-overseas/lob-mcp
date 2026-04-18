import { safeStringify } from "./redact.js";

export interface LobErrorBody {
  error?: {
    message?: string;
    status_code?: number;
    code?: string;
  };
}

export class LobApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly body: unknown;

  constructor(opts: {
    status: number;
    message: string;
    code?: string | undefined;
    requestId?: string | undefined;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "LobApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}

export function formatErrorForTool(err: unknown): string {
  if (err instanceof LobApiError) {
    const parts = [`Lob API error ${err.status}`];
    if (err.code) parts.push(`(${err.code})`);
    parts.push(`: ${err.message}`);
    if (err.requestId) parts.push(` [request_id=${err.requestId}]`);
    return parts.join("");
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return `Unknown error: ${safeStringify(err)}`;
}
