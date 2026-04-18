/**
 * Campaign and creative tools.
 *
 * A campaign is the container (audience + schedule); a creative is the artwork
 * the campaign sends (postcard / letter / self-mailer). Creating either of these
 * is NOT billable on its own — billing happens when the campaign actually sends
 * mail pieces, which is triggered separately.
 */
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

const CAMPAIGN_ID = z.string().regex(/^cmp_/).describe("Campaign ID (`cmp_…`).");
const CREATIVE_ID = z.string().regex(/^crv_/).describe("Creative ID (`crv_…`).");

export function registerCampaignTools(server: McpServer, lob: LobClient): void {
  // ── Campaigns ──────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_campaigns_create",
    annotations: { title: "Create a campaign", readOnlyHint: false },
    description:
      "Create a campaign — a container for batched mail-piece sends with a shared creative, schedule, " +
      "and audience. Creating a campaign does not by itself send mail; you trigger sends per Lob docs.",
    inputSchema: {
      name: z.string().describe("Display name for the campaign."),
      description: z.string().max(500).optional(),
      schedule_type: z
        .enum(["immediate", "scheduled_send_date"])
        .optional()
        .describe("Whether the campaign should send immediately or on a schedule."),
      send_date: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp for scheduled campaigns."),
      target_delivery_date: z.string().optional(),
      cancel_window_campaign_minutes: z
        .number()
        .int()
        .optional()
        .describe("Minutes before send during which the campaign can still be cancelled."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/campaigns",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_campaigns_list",
    annotations: { title: "List campaigns", readOnlyHint: true, idempotentHint: true },
    description: "List campaigns on your Lob account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/campaigns", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_campaigns_get",
    annotations: { title: "Retrieve a campaign", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single campaign by ID.",
    inputSchema: { id: CAMPAIGN_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/campaigns/${id}` }),
  });

  registerTool(server, {
    name: "lob_campaigns_update",
    annotations: { title: "Update a campaign", readOnlyHint: false, idempotentHint: true },
    description: "Update a campaign's metadata or schedule before it has been sent.",
    inputSchema: {
      id: CAMPAIGN_ID,
      name: z.string().optional(),
      description: z.string().max(500).optional(),
      send_date: z.string().optional(),
      target_delivery_date: z.string().optional(),
      cancel_window_campaign_minutes: z.number().int().optional(),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "PATCH",
        path: `/campaigns/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_campaigns_delete",
    annotations: {
      title: "Delete a campaign",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Delete a campaign. Only allowed before send.",
    inputSchema: { id: CAMPAIGN_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/campaigns/${id}` }),
  });

  // ── Creatives ─────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_creatives_create",
    annotations: { title: "Create a creative", readOnlyHint: false },
    description:
      "Create a campaign creative — the artwork (front/back, etc.) used by a campaign for postcards, " +
      "letters, or self-mailers.",
    inputSchema: {
      campaign_id: CAMPAIGN_ID.describe("Parent campaign ID."),
      resource_type: z.enum(["postcard", "letter", "self_mailer"]),
      front: z.string().optional().describe("Front content source (HTML/URL/template/PDF)."),
      back: z.string().optional().describe("Back content source."),
      inside: z.string().optional(),
      outside: z.string().optional(),
      file: z.string().optional().describe("Letter file content source."),
      details: z
        .record(z.unknown())
        .optional()
        .describe("Resource-specific details (size, color, etc.) per Lob docs."),
      description: z.string().max(255).optional(),
      from: z
        .union([z.string(), z.record(z.unknown())])
        .optional()
        .describe("Sender address — saved address ID or inline."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/creatives",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_creatives_get",
    annotations: { title: "Retrieve a creative", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single creative by ID.",
    inputSchema: { id: CREATIVE_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/creatives/${id}` }),
  });

  registerTool(server, {
    name: "lob_creatives_update",
    annotations: { title: "Update a creative", readOnlyHint: false, idempotentHint: true },
    description: "Update a creative's description or metadata.",
    inputSchema: {
      id: CREATIVE_ID,
      description: z.string().max(255).optional(),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "PATCH",
        path: `/creatives/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_creatives_delete",
    annotations: {
      title: "Delete a creative",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Delete a creative.",
    inputSchema: { id: CREATIVE_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/creatives/${id}` }),
  });
}
