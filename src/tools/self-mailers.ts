import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import {
  compact,
  extraParamsSchema,
  idempotencyKeySchema,
  listParamsSchema,
  mailTypeSchema,
  withExtra,
} from "../schemas/common.js";
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { registerTool } from "./helpers.js";

const SELF_MAILER_ID = z.string().regex(/^sfm_/).describe("Self-mailer ID (`sfm_…`).");
const SELF_MAILER_SIZE = z.enum(["6x18_bifold", "11x9_bifold"]);

export function registerSelfMailerTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_self_mailers_create",
    annotations: { title: "Create a self-mailer (BILLABLE)", readOnlyHint: false },
    description:
      "Create and queue a folded, tabbed self-mailer for printing and mailing. **Billable**. " +
      "Always pass `idempotency_key` to prevent duplicates on retry. Sizes: 6x18_bifold (default), 11x9_bifold.",
    inputSchema: {
      ...mailPieceCommonShape,
      inside: contentSourceSchema.describe("Inside-of-self-mailer content source."),
      outside: contentSourceSchema.describe("Outside-of-self-mailer content source."),
      size: SELF_MAILER_SIZE.optional().describe("Self-mailer size. Defaults to 6x18_bifold."),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/self_mailers",
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_self_mailers_list",
    annotations: { title: "List self-mailers", readOnlyHint: true, idempotentHint: true },
    description: "List self-mailers on your Lob account.",
    inputSchema: {
      ...listParamsSchema.shape,
      size: SELF_MAILER_SIZE.optional(),
      mail_type: mailTypeSchema,
      scheduled: z.boolean().optional(),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/self_mailers", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_self_mailers_get",
    annotations: { title: "Retrieve a self-mailer", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single self-mailer by ID.",
    inputSchema: { id: SELF_MAILER_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/self_mailers/${id}` }),
  });

  registerTool(server, {
    name: "lob_self_mailers_cancel",
    annotations: {
      title: "Cancel a scheduled self-mailer",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Cancel a self-mailer before its `send_date`.",
    inputSchema: { id: SELF_MAILER_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/self_mailers/${id}` }),
  });
}
