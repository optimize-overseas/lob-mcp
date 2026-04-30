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
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const CAMPAIGN_ID = z.string().regex(/^cmp_/).describe("Campaign ID (`cmp_…`).");
const CREATIVE_ID = z.string().regex(/^crv_/).describe("Creative ID (`crv_…`).");

export function registerCampaignTools(server: McpServer, lob: LobClient): void {
  // ── Campaigns ──────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_campaigns_create",
    annotations: { title: "Create a campaign", ...ToolAnnotationPresets.mutate },
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
    annotations: { title: "List campaigns", ...ToolAnnotationPresets.read },
    description:
      "List campaigns on your Lob account. **For 'how many campaigns?' counts, pass " +
      "`include: ['total_count']` with `limit: 1`.** Filter by `date_created` or `metadata`.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/campaigns", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_campaigns_get",
    annotations: { title: "Retrieve a campaign", ...ToolAnnotationPresets.read },
    description: "Retrieve a single campaign by ID.",
    inputSchema: { id: CAMPAIGN_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/campaigns/${id}` }),
  });

  registerTool(server, {
    name: "lob_campaigns_update",
    annotations: { title: "Update a campaign", ...ToolAnnotationPresets.mutate },
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
    annotations: { title: "Delete a campaign", ...ToolAnnotationPresets.destructive },
    description: "Delete a campaign. Only allowed before send.",
    inputSchema: { id: CAMPAIGN_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/campaigns/${id}` }),
  });

  // ── Creatives ─────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_creatives_create",
    annotations: { title: "Create a creative", ...ToolAnnotationPresets.mutate },
    description:
      "Create a campaign creative — the artwork (front/back / inside/outside / file) used by a campaign " +
      "for postcards, letters, or self-mailers. **Important:** unlike `lob_postcards_create` and the other " +
      "mail-piece create tools, Lob's `/v1/creatives` endpoint does NOT accept HTML strings, remote URLs, " +
      "or inline PDFs in the content fields — it accepts ONLY a Lob template ID (`tmpl_…`). To use a URL " +
      "or HTML as creative content, first call `lob_templates_create` to upload it as a template, then " +
      "pass the resulting `tmpl_…` here. Required by `resource_type`: postcard → `front` + `back`; " +
      "letter → `file` + `from`; self_mailer → `inside` + `outside`. Live-mode key required.",
    inputSchema: {
      campaign_id: CAMPAIGN_ID.describe("Parent campaign ID."),
      resource_type: z.enum(["postcard", "letter", "self_mailer"]),
      front: z
        .string()
        .regex(/^tmpl_/)
        .optional()
        .describe("Postcard creative front: a Lob template ID (`tmpl_…`). Required for postcard creatives."),
      back: z
        .string()
        .regex(/^tmpl_/)
        .optional()
        .describe("Postcard creative back: a Lob template ID (`tmpl_…`). Required for postcard creatives."),
      inside: z
        .string()
        .regex(/^tmpl_/)
        .optional()
        .describe("Self-mailer creative inside: a Lob template ID."),
      outside: z
        .string()
        .regex(/^tmpl_/)
        .optional()
        .describe("Self-mailer creative outside: a Lob template ID."),
      file: z
        .string()
        .regex(/^tmpl_/)
        .optional()
        .describe("Letter creative file: a Lob template ID. Required for letter creatives."),
      details: z
        .record(z.unknown())
        .default({})
        .describe(
          "Resource-specific options. Per Lob's spec, accepted keys for postcard creatives are " +
            "`mail_type` (usps_first_class | usps_standard) and `size` (4x6 | 6x9 | 6x11). For letters: " +
            "`mail_type`, `color`, `double_sided`, `address_placement`, `extra_service`. Empty `{}` is valid.",
        ),
      description: z.string().max(255).optional(),
      from: z
        .union([z.string().regex(/^adr_/), z.record(z.unknown())])
        .optional()
        .describe(
          "Sender address — saved address ID (`adr_…`) or inline. Required for letter creatives.",
        ),
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
    annotations: { title: "Retrieve a creative", ...ToolAnnotationPresets.read },
    description: "Retrieve a single creative by ID.",
    inputSchema: { id: CREATIVE_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/creatives/${id}` }),
  });

  registerTool(server, {
    name: "lob_creatives_update",
    annotations: { title: "Update a creative", ...ToolAnnotationPresets.mutate },
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
    annotations: { title: "Delete a creative", ...ToolAnnotationPresets.destructive },
    description: "Delete a creative.",
    inputSchema: { id: CREATIVE_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/creatives/${id}` }),
  });
}
