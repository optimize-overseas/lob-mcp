import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import { compact, dateFilterSchema, listParamsSchema } from "../schemas/common.js";
import { registerTool } from "./helpers.js";

export function registerTrackingTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_tracking_events_list",
    annotations: { title: "List tracking events", readOnlyHint: true, idempotentHint: true },
    description:
      "List USPS tracking events (e.g. 'Mailed', 'In Transit', 'Delivered', 'Re-Routed', 'Returned to Sender') " +
      "for mail pieces on your account. Filter by mail piece ID or date range. " +
      "For real-time delivery, subscribe to a webhook via `lob_webhooks_create` instead of polling.",
    inputSchema: {
      ...listParamsSchema.shape,
      resource_id: z
        .string()
        .optional()
        .describe("Filter to events for a specific mail piece (postcard/letter/check/self-mailer ID)."),
      type: z
        .string()
        .optional()
        .describe("Filter by event type, e.g. 'usps.delivered'."),
      time: dateFilterSchema
        .optional()
        .describe("ISO8601 date filter on event time, e.g. { gt: '2026-01-01' }."),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/tracking_events", query: compact(args) }),
  });
}
