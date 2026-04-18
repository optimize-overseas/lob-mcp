import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import {
  compact,
  extraParamsSchema,
  listParamsSchema,
  metadataSchema,
  withExtra,
} from "../schemas/common.js";
import { registerTool } from "./helpers.js";

const WH_ID = z.string().regex(/^whk_/).describe("Webhook ID (`whk_…`).");

export function registerWebhookTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_webhooks_create",
    annotations: { title: "Create a webhook subscription", readOnlyHint: false },
    description:
      "Subscribe an HTTPS endpoint to receive Lob event notifications (e.g. 'postcard.mailed', " +
      "'letter.in_transit', 'check.delivered'). The endpoint must respond with 2xx within 5 seconds.",
    inputSchema: {
      url: z.string().url().describe("HTTPS URL to receive event POSTs."),
      enabled_events: z
        .array(z.string())
        .min(1)
        .describe("Event types to subscribe to, e.g. ['postcard.mailed', 'letter.delivered']. Use ['*'] for all."),
      description: z.string().max(255).optional(),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/webhooks",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_webhooks_list",
    annotations: { title: "List webhooks", readOnlyHint: true, idempotentHint: true },
    description: "List webhook subscriptions on your account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/webhooks", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_webhooks_get",
    annotations: { title: "Retrieve a webhook", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single webhook subscription by ID.",
    inputSchema: { id: WH_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/webhooks/${id}` }),
  });

  registerTool(server, {
    name: "lob_webhooks_update",
    annotations: { title: "Update a webhook", readOnlyHint: false, idempotentHint: true },
    description: "Update a webhook's URL, enabled events, or status.",
    inputSchema: {
      id: WH_ID,
      url: z.string().url().optional(),
      enabled_events: z.array(z.string()).optional(),
      description: z.string().max(255).optional(),
      disabled: z.boolean().optional().describe("Set true to pause delivery without deleting."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "PATCH",
        path: `/webhooks/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_webhooks_delete",
    annotations: {
      title: "Delete a webhook",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Delete a webhook subscription.",
    inputSchema: { id: WH_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/webhooks/${id}` }),
  });
}
