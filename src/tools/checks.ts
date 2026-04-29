/**
 * Check tools — preview / create / list / get / cancel.
 *
 * Lob has no `/resource_proofs` endpoint for checks, so the preview returns a
 * textual summary instead of a Lob-rendered PDF. The token still binds the
 * payload — committing a different amount/recipient than the previewed one is
 * rejected with PAYLOAD_MISMATCH.
 *
 * `lob_checks_create` is the highest-impact tool here: it incurs Lob fees AND
 * draws funds from the linked bank account when the recipient cashes the check.
 * If LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD is set and `payload.amount`
 * exceeds it, an elicitation prompt fires before dispatch.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import type { TokenStore } from "../preview/token-store.js";
import { buildPreviewCommit } from "../preview/preview-commit.js";
import type { PieceCounter } from "../safety/piece-counter.js";
import { elicitOrFail } from "../safety/elicit.js";
import {
  compact,
  dateFilterSchema,
  extraParamsSchema,
  idempotencyKeyAutoSchema,
  listParamsSchema,
  withExtra,
} from "../schemas/common.js";
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const CHECK_ID = z.string().regex(/^chk_/).describe("Check ID (`chk_…`).");

const checkCreateShape = {
  ...mailPieceCommonShape,
  bank_account: z
    .string()
    .regex(/^bank_/)
    .describe("Verified Lob bank account ID."),
  amount: z.number().positive().describe("Check amount in USD (e.g. 125.50)."),
  check_number: z
    .number()
    .int()
    .optional()
    .describe("Optional check number; auto-assigned if omitted."),
  memo: z
    .string()
    .max(40)
    .optional()
    .describe("Memo line on the check (max 40 chars)."),
  message: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Plain-text message printed on the bottom of the check page (max 400 chars). " +
        "Mutually exclusive with `check_bottom`.",
    ),
  check_bottom: contentSourceSchema
    .optional()
    .describe(
      "Custom artwork for the bottom half of the check page. Accepts a Lob template ID (`tmpl_…`), " +
        "an HTML string, an https:// URL, or a base64 PDF. Mutually exclusive with `message`.",
    ),
  logo: contentSourceSchema
    .optional()
    .describe("Logo printed on the check face (upper-left, grayscale; PNG or JPG)."),
  attachment: contentSourceSchema
    .optional()
    .describe(
      "Secondary document included in the envelope after the check page. Up to 6 pages.",
    ),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const checkCommitShape = {
  ...checkCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_checks_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

export function registerCheckTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  const pc = buildPreviewCommit({
    baseName: "lob_checks",
    baseSchema: checkCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => ({
        kind: "textual_preview",
        note:
          "Lob does not produce check proofs. This preview confirms validation only — no PDF is rendered. " +
          "The returned confirmation_token binds the payload: committing a different amount or recipient " +
          "will be rejected.",
        bank_account: payload.bank_account,
        amount_usd: payload.amount,
        check_number: payload.check_number ?? "auto-assigned",
        memo: payload.memo,
      }),
      beforeDispatch: async (payload, serverCtx) => {
        pieceCounter.checkAndReserve(1);
        const threshold = lob.env.requireElicitationForChecksOverUsd;
        const amount = Number(payload.amount);
        if (threshold != null && amount > threshold) {
          await elicitOrFail(serverCtx as { mcpReq?: { elicitInput?: (req: unknown) => Promise<{ action: string; content?: unknown }> } } | undefined, {
            title: "Confirm large check",
            message:
              `About to commit a $${amount.toFixed(2)} check from bank account ${payload.bank_account}. ` +
              "This is irreversible: physical mail will be produced and the amount will be drawn from the linked account when cashed.",
          });
        }
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: "/checks",
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(1);
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_checks_preview",
    annotations: { title: "Preview a check", ...ToolAnnotationPresets.preview },
    description:
      "Validate a check payload and return a textual summary. **Lob does not produce check proofs**, " +
      "so no PDF is rendered. Returns a `confirmation_token` to pass to lob_checks_create — required in " +
      "live mode. The token binds the payload: committing a different amount or recipient is rejected.",
    inputSchema: checkCreateShape,
    handler: pc.preview,
  });

  registerTool(server, {
    name: "lob_checks_create",
    annotations: {
      title: "Create a check (BILLABLE + DRAWS FUNDS)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a check send. **HIGH IMPACT**: incurs Lob fees AND draws the check `amount` from the " +
      "linked bank account when cashed. Requires a verified bank account ID (`bank_…`). In live mode, " +
      "requires a `confirmation_token` from lob_checks_preview that matches the current payload. " +
      "If LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD is set and `amount` exceeds it, an elicitation " +
      "form must be confirmed by the user before dispatch.\n\n" +
      "For the bottom of the check page, Lob requires exactly one of `message` (plain text, max 400 " +
      "chars) or `check_bottom` (custom template / HTML / PDF, typically paired with `merge_variables`).",
    inputSchema: checkCommitShape,
    handler: pc.commit,
  });

  registerTool(server, {
    name: "lob_checks_list",
    annotations: { title: "List checks", ...ToolAnnotationPresets.read },
    description: "List checks on your Lob account.",
    inputSchema: {
      ...listParamsSchema.shape,
      scheduled: z.boolean().optional(),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/checks", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_checks_get",
    annotations: { title: "Retrieve a check", ...ToolAnnotationPresets.read },
    description: "Retrieve a single check by ID.",
    inputSchema: { id: CHECK_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/checks/${id}` }),
  });

  registerTool(server, {
    name: "lob_checks_cancel",
    annotations: {
      title: "Cancel a scheduled check",
      ...ToolAnnotationPresets.destructive,
    },
    description:
      "Cancel a check before its `send_date`. Once printed/mailed, checks cannot be cancelled — " +
      "you would need to issue a stop-payment with the bank.",
    inputSchema: { id: CHECK_ID },
    handler: async ({ id }) =>
      lob.request({ method: "DELETE", path: `/checks/${id}` }),
  });
}
