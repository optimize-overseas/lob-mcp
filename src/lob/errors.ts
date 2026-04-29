/**
 * Structured error types and a tool-friendly formatter.
 *
 * `formatErrorForTool` is the single chokepoint for surfacing failures back
 * through the MCP transport. It deliberately does NOT include the request body
 * — that may contain PII.
 *
 * Two error shapes are routed here:
 *   • LobApiError — the upstream Lob API rejected the call (HTTP non-2xx).
 *   • LobMcpError — our own server-side guard rejected the call before it
 *     reached Lob (token validation, piece cap, declined elicitation, etc.).
 */
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

/** Server-side error codes surfaced to tools when our own guards reject a call. */
export const LobMcpErrorCodes = {
  TOKEN_REQUIRED: "LOB_TOKEN_REQUIRED",
  TOKEN_NOT_FOUND: "LOB_TOKEN_NOT_FOUND",
  TOKEN_EXPIRED: "LOB_TOKEN_EXPIRED",
  TOKEN_PAYLOAD_MISMATCH: "LOB_TOKEN_PAYLOAD_MISMATCH",
  PIECE_CAP_EXCEEDED: "LOB_PIECE_CAP_EXCEEDED",
  CONFIRMATION_DECLINED: "LOB_CONFIRMATION_DECLINED",
} as const;

export type LobMcpErrorCode =
  (typeof LobMcpErrorCodes)[keyof typeof LobMcpErrorCodes];

export class LobMcpError extends Error {
  readonly code: LobMcpErrorCode;
  readonly nextStep: string | undefined;

  constructor(code: LobMcpErrorCode, message: string, nextStep?: string) {
    super(message);
    this.name = "LobMcpError";
    this.code = code;
    this.nextStep = nextStep;
  }
}

export function formatErrorForTool(err: unknown): string {
  if (err instanceof LobMcpError) {
    return err.nextStep
      ? `${err.code}: ${err.message} Next: ${err.nextStep}`
      : `${err.code}: ${err.message}`;
  }
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
