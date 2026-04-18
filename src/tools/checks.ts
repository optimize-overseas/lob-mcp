/**
 * Check tools — create / list / get / cancel. Checks are printed and mailed
 * physically and draw funds from a verified Lob bank account when cashed.
 *
 * `lob_checks_create` is the highest-impact tool in this server: it both incurs
 * Lob fees AND moves real money. Hosts should treat its destructive/billable
 * hints accordingly.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import {
  compact,
  dateFilterSchema,
  extraParamsSchema,
  idempotencyKeySchema,
  listParamsSchema,
  withExtra,
} from "../schemas/common.js";
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { registerTool } from "./helpers.js";

const CHECK_ID = z.string().regex(/^chk_/).describe("Check ID (`chk_…`).");

export function registerCheckTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_checks_create",
    annotations: { title: "Create a check (BILLABLE + DRAWS FUNDS)", readOnlyHint: false },
    description:
      "Create and mail a printed check drawn against a verified bank account. **HIGH IMPACT**: " +
      "this both costs Lob fees AND draws the check `amount` from the linked bank account when cashed. " +
      "Always pass `idempotency_key` (e.g. a UUID). Requires a verified bank account ID (`bank_…`). " +
      "For the bottom of the check page, Lob requires exactly one of `message` (plain text, max 400 chars) " +
      "or `check_bottom` (custom template / HTML / PDF, typically paired with `merge_variables` for " +
      "templated remittance or stub designs).",
    inputSchema: {
      ...mailPieceCommonShape,
      bank_account: z.string().regex(/^bank_/).describe("Verified Lob bank account ID."),
      amount: z.number().positive().describe("Check amount in USD (e.g. 125.50)."),
      check_number: z
        .number()
        .int()
        .optional()
        .describe("Optional check number; auto-assigned if omitted."),
      memo: z.string().max(40).optional().describe("Memo line on the check (max 40 chars)."),
      message: z
        .string()
        .max(400)
        .optional()
        .describe(
          "Plain-text message printed on the bottom of the check page (max 400 chars). " +
            "Mutually exclusive with `check_bottom` — Lob requires exactly one of the two. " +
            "Use `message` for a simple text note; use `check_bottom` for full custom artwork.",
        ),
      check_bottom: contentSourceSchema.optional().describe(
        "Custom artwork for the bottom half of the check page (below the payment voucher). " +
          "Accepts the same content-source forms as `file`/`front`/`back`: a Lob template ID (`tmpl_…`), " +
          "an HTML string, an https:// URL, or a base64 PDF. Mutually exclusive with `message` — " +
          "Lob requires exactly one of the two. Prints in black & white; 8.5\"x11\" artwork must conform " +
          "to Lob's check-bottom template. Pairs naturally with `merge_variables` for templated stubs — " +
          "pass a `tmpl_…` ID plus a map of per-recipient merge fields (e.g. payee name, amount, " +
          "reference numbers) to personalize every check.",
      ),
      logo: contentSourceSchema
        .optional()
        .describe("Logo printed on the check face (upper-left, grayscale; PNG or JPG)."),
      attachment: contentSourceSchema.optional().describe(
        "Secondary document included in the envelope after the check page (e.g. an invoice or remittance advice). " +
          "Accepts a template ID, HTML, URL, or base64 PDF. PDFs are capped at 6 pages; printed double-sided B&W.",
      ),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/checks",
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_checks_list",
    annotations: { title: "List checks", readOnlyHint: true, idempotentHint: true },
    description: "List checks on your Lob account.",
    inputSchema: {
      ...listParamsSchema.shape,
      scheduled: z.boolean().optional(),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) => lob.request({ method: "GET", path: "/checks", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_checks_get",
    annotations: { title: "Retrieve a check", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single check by ID.",
    inputSchema: { id: CHECK_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/checks/${id}` }),
  });

  registerTool(server, {
    name: "lob_checks_cancel",
    annotations: {
      title: "Cancel a scheduled check",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description:
      "Cancel a check before its `send_date`. Once printed/mailed, checks cannot be cancelled — " +
      "you would need to issue a stop-payment with the bank.",
    inputSchema: { id: CHECK_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/checks/${id}` }),
  });
}
