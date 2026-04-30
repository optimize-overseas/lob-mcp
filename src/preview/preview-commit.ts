/**
 * Two-tool preview/commit factory.
 *
 * For each billable resource, callers pass a baseSchema, the env, the token
 * store, and two closures: renderPreview (producing the preview body) and
 * callCommit (making the live POST). buildPreviewCommit returns matching
 * `preview` and `commit` handlers ready to plug into registerTool.
 *
 * Behaviour:
 *   • preview validates and renders, stores a PreviewRecord with payload hash,
 *     and returns { confirmation_token, expires_at, preview }.
 *   • commit:
 *       – if a token is supplied, atomically consumes + payload-hash-checks it.
 *       – if effective mode is live AND env.requireConfirmation, a token is
 *         required (LOB_TOKEN_REQUIRED otherwise).
 *       – derives the idempotency key from the token (`lob-mcp-${token}`)
 *         unless the caller supplied one explicitly.
 *       – fires beforeDispatch (piece-counter + elicitation) then callCommit.
 *       – returns { idempotency_key_used, confirmation_token_consumed, result }.
 */
import { randomUUID } from "node:crypto";
import type { ZodRawShape, infer as zInfer } from "zod";
import type { LobEnv } from "../env.js";
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";
import { hashPayload } from "./payload-hash.js";
import type { PreviewRecord } from "./preview-record.js";
import type { TokenStore } from "./token-store.js";

export interface PreviewCommitContext {
  env: LobEnv;
  tokenStore: TokenStore;
  renderPreview: (payload: Record<string, unknown>) => Promise<unknown>;
  callCommit: (
    payload: Record<string, unknown>,
    opts: { idempotencyKey: string; confirmationToken: string | undefined },
  ) => Promise<unknown>;
  /**
   * Optional hook fired after token validation, before callCommit. Used for
   * piece-counter reservation and elicitation. May throw LobMcpError to abort
   * the commit.
   */
  beforeDispatch?: (
    payload: Record<string, unknown>,
    serverCtx: unknown,
  ) => Promise<void>;
}

export interface PreviewCommitTools<TShape extends ZodRawShape> {
  preview: (input: { [K in keyof TShape]: zInfer<TShape[K]> }) => Promise<unknown>;
  commit: (
    input: { [K in keyof TShape]: zInfer<TShape[K]> } & {
      confirmation_token?: string;
      idempotency_key?: string;
    },
    serverCtx?: unknown,
  ) => Promise<unknown>;
}

export function buildPreviewCommit<TShape extends ZodRawShape>(opts: {
  baseName: string;
  baseSchema: TShape;
  ctx: PreviewCommitContext;
}): PreviewCommitTools<TShape> {
  const { baseName, ctx } = opts;

  return {
    async preview(input) {
      const payload = stripUndefined(input as Record<string, unknown>);
      const previewResponse = await ctx.renderPreview(payload);
      const token = randomUUID();
      const now = Date.now();
      const ttlMs = Math.max(0, ctx.env.confirmationTtlSeconds * 1000);
      const record: PreviewRecord = {
        token,
        toolName: baseName,
        payloadHash: hashPayload(payload),
        payload,
        previewResponse,
        createdAt: now,
        expiresAt: now + ttlMs,
      };
      ctx.tokenStore.put(record);
      return {
        confirmation_token: token,
        expires_at: new Date(record.expiresAt).toISOString(),
        preview: previewResponse,
      };
    },

    async commit(input, serverCtx) {
      const inputAny = input as Record<string, unknown>;
      const confirmationToken = inputAny.confirmation_token as string | undefined;
      const explicitKey = inputAny.idempotency_key as string | undefined;
      const { confirmation_token: _t, idempotency_key: _i, ...rest } = inputAny;
      const payload = stripUndefined(rest);

      const requireToken =
        ctx.env.requireConfirmation && ctx.env.effectiveCommitMode === "live";

      let consumedToken: string | undefined;
      if (confirmationToken) {
        const record = ctx.tokenStore.consume(String(confirmationToken));
        if (!record) {
          throw new LobMcpError(
            LobMcpErrorCodes.TOKEN_NOT_FOUND,
            "Confirmation token not found, expired, or already consumed.",
            `Call ${baseName}_preview again to obtain a fresh token.`,
          );
        }
        if (hashPayload(payload) !== record.payloadHash) {
          throw new LobMcpError(
            LobMcpErrorCodes.TOKEN_PAYLOAD_MISMATCH,
            "Payload differs from the previewed payload.",
            `Call ${baseName}_preview again with the current parameters.`,
          );
        }
        consumedToken = record.token;
      } else if (requireToken) {
        throw new LobMcpError(
          LobMcpErrorCodes.TOKEN_REQUIRED,
          "Live mode requires a confirmation_token from the matching preview tool.",
          `Call ${baseName}_preview with the same parameters to obtain a token.`,
        );
      }

      const idempotencyKey =
        explicitKey ??
        (consumedToken ? `lob-mcp-${consumedToken}` : `lob-mcp-${randomUUID()}`);

      if (ctx.beforeDispatch) await ctx.beforeDispatch(payload, serverCtx);

      const result = await ctx.callCommit(payload, {
        idempotencyKey,
        confirmationToken: consumedToken,
      });

      return {
        idempotency_key_used: idempotencyKey,
        confirmation_token_consumed: consumedToken ?? null,
        result,
      };
    },
  };
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
