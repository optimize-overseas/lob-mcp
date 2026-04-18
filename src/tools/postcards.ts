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
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { registerTool } from "./helpers.js";

const POSTCARD_ID = z.string().regex(/^psc_/).describe("Postcard ID (`psc_…`).");
const POSTCARD_SIZE = z.enum(["4x6", "6x9", "6x11"]);

export function registerPostcardTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_postcards_create",
    annotations: { title: "Create a postcard (BILLABLE)", readOnlyHint: false },
    description:
      "Create and queue a postcard for printing and mailing. **Billable**: this produces real " +
      "physical mail and is charged to your Lob account. Always pass `idempotency_key` (e.g. a UUID) " +
      "so retries do not duplicate the postcard. Sizes: 4x6 (default), 6x9, 6x11.",
    inputSchema: {
      ...mailPieceCommonShape,
      front: contentSourceSchema.describe("Front-of-postcard content source."),
      back: contentSourceSchema.describe("Back-of-postcard content source."),
      size: POSTCARD_SIZE.optional().describe("Postcard size. Defaults to 4x6."),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/postcards",
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_postcards_list",
    annotations: { title: "List postcards", readOnlyHint: true, idempotentHint: true },
    description: "List postcards on your Lob account, with cursor pagination and filtering.",
    inputSchema: {
      ...listParamsSchema.shape,
      size: POSTCARD_SIZE.optional(),
      mail_type: mailTypeSchema,
      scheduled: z.boolean().optional().describe("Filter to scheduled-but-not-sent postcards."),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) => lob.request({ method: "GET", path: "/postcards", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_postcards_get",
    annotations: { title: "Retrieve a postcard", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single postcard by ID.",
    inputSchema: { id: POSTCARD_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/postcards/${id}` }),
  });

  registerTool(server, {
    name: "lob_postcards_cancel",
    annotations: {
      title: "Cancel a scheduled postcard",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description:
      "Cancel a postcard before its `send_date`. Only works while the postcard is still in a " +
      "cancellable state — production-locked pieces cannot be cancelled.",
    inputSchema: { id: POSTCARD_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/postcards/${id}` }),
  });
}
