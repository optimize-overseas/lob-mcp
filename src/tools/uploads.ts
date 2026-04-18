/**
 * Upload-style and ancillary resources: buckslips, cards, their print orders,
 * informed-delivery campaigns, QR-code analytics, and resource proofs.
 *
 * Buckslip and card *uploads* register inventory with Lob (not billable). The
 * paired *_orders_create tools that print physical inventory ARE billable.
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
  metadataSchema,
  withExtra,
} from "../schemas/common.js";
import { registerTool } from "./helpers.js";

const BUCKSLIP_ID = z.string().regex(/^bck_/).describe("Buckslip ID (`bck_…`).");
const CARD_ID = z.string().regex(/^card_/).describe("Card ID (`card_…`).");
const RP_ID = z.string().describe("Resource proof ID.");

export function registerUploadsTools(server: McpServer, lob: LobClient): void {
  // ── Buckslips ──────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_buckslips_create",
    annotations: { title: "Create a buckslip", readOnlyHint: false },
    description:
      "Upload a buckslip — a 8.75x3.75 inch promotional insert that can be inserted into letters. " +
      "Inventory is reserved on Lob's side and consumed when ordered.",
    inputSchema: {
      front: z.string().describe("Front content source (HTML/URL/PDF)."),
      back: z.string().describe("Back content source."),
      description: z.string().max(255).optional(),
      size: z.string().optional().describe("Buckslip size, e.g. '8.75x3.75'."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/buckslips",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_buckslips_list",
    annotations: { title: "List buckslips", readOnlyHint: true, idempotentHint: true },
    description: "List buckslip inventory on your account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/buckslips", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_buckslips_get",
    annotations: { title: "Retrieve a buckslip", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single buckslip by ID.",
    inputSchema: { id: BUCKSLIP_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/buckslips/${id}` }),
  });

  registerTool(server, {
    name: "lob_buckslip_orders_create",
    annotations: { title: "Order buckslip inventory (BILLABLE)", readOnlyHint: false },
    description:
      "Order printed buckslip inventory. **Billable** — Lob prints and stocks the requested quantity. " +
      "Pass `idempotency_key` to prevent duplicate orders on retry.",
    inputSchema: {
      buckslip_id: BUCKSLIP_ID,
      quantity: z.number().int().positive().describe("Number of buckslips to order."),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { buckslip_id, idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/buckslips/${buckslip_id}/orders`,
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_buckslip_orders_list",
    annotations: { title: "List buckslip orders", readOnlyHint: true, idempotentHint: true },
    description: "List orders for a specific buckslip.",
    inputSchema: { buckslip_id: BUCKSLIP_ID, ...listParamsSchema.shape },
    handler: async (args) => {
      const { buckslip_id, ...query } = args;
      return lob.request({
        method: "GET",
        path: `/buckslips/${buckslip_id}/orders`,
        query: compact(query),
      });
    },
  });

  // ── Cards ─────────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_cards_create",
    annotations: { title: "Create a card", readOnlyHint: false },
    description:
      "Upload a card — a small printed insert (e.g. business card, plastic gift card) that can be " +
      "inserted with a letter.",
    inputSchema: {
      front: z.string().describe("Front content source."),
      back: z.string().optional().describe("Back content source."),
      description: z.string().max(255).optional(),
      size: z.string().optional().describe("Card size per Lob docs."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/cards",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_cards_list",
    annotations: { title: "List cards", readOnlyHint: true, idempotentHint: true },
    description: "List cards on your account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/cards", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_cards_get",
    annotations: { title: "Retrieve a card", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single card by ID.",
    inputSchema: { id: CARD_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/cards/${id}` }),
  });

  registerTool(server, {
    name: "lob_card_orders_create",
    annotations: { title: "Order card inventory (BILLABLE)", readOnlyHint: false },
    description:
      "Order printed card inventory. **Billable** — Lob prints and stocks the requested quantity. " +
      "Pass `idempotency_key` to prevent duplicate orders on retry.",
    inputSchema: {
      card_id: CARD_ID,
      quantity: z.number().int().positive(),
      idempotency_key: idempotencyKeySchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { card_id, idempotency_key, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/cards/${card_id}/orders`,
        body: withExtra(rest, extra),
        idempotencyKey: idempotency_key,
      });
    },
  });

  registerTool(server, {
    name: "lob_card_orders_list",
    annotations: { title: "List card orders", readOnlyHint: true, idempotentHint: true },
    description: "List orders for a specific card.",
    inputSchema: { card_id: CARD_ID, ...listParamsSchema.shape },
    handler: async (args) => {
      const { card_id, ...query } = args;
      return lob.request({
        method: "GET",
        path: `/cards/${card_id}/orders`,
        query: compact(query),
      });
    },
  });

  // ── QR codes & resource proofs ────────────────────────────────────────────

  registerTool(server, {
    name: "lob_qr_codes_list",
    annotations: { title: "List QR code analytics", readOnlyHint: true, idempotentHint: true },
    description:
      "List QR code scans / analytics events for QR codes embedded in your mail pieces.",
    inputSchema: {
      ...listParamsSchema.shape,
      resource_id: z
        .string()
        .optional()
        .describe("Filter to scans tied to a specific mail-piece ID."),
      campaign_id: z.string().optional(),
      date_scanned: dateFilterSchema.optional(),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/qr_code_analytics", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_resource_proofs_create",
    annotations: { title: "Create a resource proof", readOnlyHint: false },
    description:
      "Create a proof — a PDF preview of how a resource (postcard, letter, self-mailer) will print — " +
      "for review before committing to a mail send. Pass `resource_parameters` with the same shape you " +
      "would pass to the underlying create endpoint (e.g. `{ front, back, to }` for a postcard).",
    inputSchema: {
      resource_type: z
        .enum(["postcard", "letter", "self_mailer"])
        .describe("Type of resource being proofed."),
      resource_parameters: z
        .record(z.unknown())
        .describe(
          "Parameters matching the resource type's create shape — e.g. `{ front, back, to }` for a " +
            "postcard, `{ file, to }` for a letter. Each field accepts an HTML string, URL, or template ID.",
        ),
      template_id: z.string().optional().describe("Optional template ID to associate with the proof."),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/resource_proofs",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_resource_proofs_get",
    annotations: { title: "Retrieve a resource proof", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a resource proof by ID, including a URL to download the proof PDF.",
    inputSchema: { id: RP_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/resource_proofs/${id}` }),
  });

  registerTool(server, {
    name: "lob_resource_proofs_update",
    annotations: { title: "Approve/reject a resource proof", readOnlyHint: false, idempotentHint: true },
    description: "Approve or reject a resource proof.",
    inputSchema: {
      id: RP_ID,
      status: z.enum(["approved", "rejected"]).optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "PATCH",
        path: `/resource_proofs/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });
}
