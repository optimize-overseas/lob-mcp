/**
 * Letter tools — create / list / get / cancel. Letters mail in #10 double-window
 * envelopes and support inserts (cards, buckslips), return envelopes, perforation,
 * and USPS extra services (certified, registered).
 *
 * `lob_letters_create` is BILLABLE.
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
  mailTypeSchema,
  withExtra,
} from "../schemas/common.js";
import {
  addressPlacementSchema,
  colorSchema,
  contentSourceSchema,
  customEnvelopeSchema,
  doubleSidedSchema,
  mailPieceCommonShape,
} from "../schemas/mail.js";
import { registerTool } from "./helpers.js";

const LETTER_ID = z.string().regex(/^ltr_/).describe("Letter ID (`ltr_…`).");

export function registerLetterTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_letters_create",
    annotations: { title: "Create a letter (BILLABLE)", readOnlyHint: false },
    description:
      "Create and queue a letter for printing and mailing in a #10 double-window envelope. **Billable**: " +
      "produces real physical mail and is charged to your Lob account. Always pass `idempotency_key` " +
      "(e.g. a UUID) so retries do not duplicate the letter.",
    inputSchema: {
      ...mailPieceCommonShape,
      file: contentSourceSchema.describe("Letter body content source (HTML, URL, template ID, or base64 PDF)."),
      color: colorSchema,
      double_sided: doubleSidedSchema,
      address_placement: addressPlacementSchema,
      return_envelope: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe("Include a return envelope. Boolean true for default, or a return envelope ID."),
      perforated_page: z
        .number()
        .int()
        .optional()
        .describe("Page number to perforate (used with return_envelope)."),
      custom_envelope: customEnvelopeSchema,
      extra_service: z
        .enum(["certified", "certified_return_receipt", "registered"])
        .optional()
        .describe("USPS extra service add-on. Affects pricing and delivery time."),
      cards: z
        .array(z.string())
        .optional()
        .describe("Card IDs (`card_…`) to insert. Up to 4."),
      buckslips: z
        .array(z.object({ id: z.string() }).passthrough())
        .optional()
        .describe("Buckslip references to insert."),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/letters",
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_letters_list",
    annotations: { title: "List letters", readOnlyHint: true, idempotentHint: true },
    description: "List letters on your Lob account, with cursor pagination and filtering.",
    inputSchema: {
      ...listParamsSchema.shape,
      mail_type: mailTypeSchema,
      color: z.boolean().optional(),
      scheduled: z.boolean().optional(),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) => lob.request({ method: "GET", path: "/letters", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_letters_get",
    annotations: { title: "Retrieve a letter", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single letter by ID.",
    inputSchema: { id: LETTER_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/letters/${id}` }),
  });

  registerTool(server, {
    name: "lob_letters_cancel",
    annotations: {
      title: "Cancel a scheduled letter",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Cancel a letter before its `send_date`. Production-locked letters cannot be cancelled.",
    inputSchema: { id: LETTER_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/letters/${id}` }),
  });
}
