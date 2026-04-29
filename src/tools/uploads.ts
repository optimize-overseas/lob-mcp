/**
 * Upload-style and ancillary resources: buckslips, cards, their print orders,
 * QR-code analytics, and resource proofs.
 *
 * Buckslip and card *uploads* register inventory with Lob (not billable). The
 * paired `*_orders_create` tools that print physical inventory ARE billable —
 * they get the preview/commit treatment with a textual preview (Lob has no
 * proof endpoint for inventory orders) and the bulk-pieces elicitation gate.
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
  metadataSchema,
  withExtra,
} from "../schemas/common.js";
import { findSpec } from "../specs/manifest.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const BUCKSLIP_ID = z.string().regex(/^bck_/).describe("Buckslip ID (`bck_…`).");
const CARD_ID = z.string().regex(/^card_/).describe("Card ID (`card_…`).");
const RP_ID = z.string().describe("Resource proof ID.");

const buckslipOrderCreateShape = {
  buckslip_id: BUCKSLIP_ID,
  quantity_ordered: z
    .number()
    .int()
    .positive()
    .describe("Number of buckslips to order."),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const buckslipOrderCommitShape = {
  ...buckslipOrderCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_buckslip_orders_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

const cardOrderCreateShape = {
  card_id: CARD_ID,
  quantity: z
    .number()
    .int()
    .positive()
    .describe(
      "Number of cards to order. (Note: buckslip orders use `quantity_ordered`; Lob's API differs per resource.)",
    ),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const cardOrderCommitShape = {
  ...cardOrderCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_card_orders_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

export function registerUploadsTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  // ── Buckslips ──────────────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_buckslips_create",
    annotations: { title: "Create a buckslip", ...ToolAnnotationPresets.mutate },
    description:
      "Upload a buckslip — an 8.75\"×3.75\" promotional insert that can be included in letters. " +
      "`front` must be a publicly-reachable PDF URL (or base64 data URI). Inventory is reserved on " +
      "Lob's side and consumed when ordered. Note: Lob's buckslips API only accepts multipart/form-data, " +
      "so this tool sends the body as multipart.",
    inputSchema: {
      front: z.string().describe("Front content source — PDF URL (required)."),
      back: z.string().optional().describe("Back content source — PDF URL."),
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
        asForm: true,
      });
    },
  });

  registerTool(server, {
    name: "lob_buckslips_list",
    annotations: { title: "List buckslips", ...ToolAnnotationPresets.read },
    description: "List buckslip inventory on your account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/buckslips", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_buckslips_get",
    annotations: { title: "Retrieve a buckslip", ...ToolAnnotationPresets.read },
    description: "Retrieve a single buckslip by ID.",
    inputSchema: { id: BUCKSLIP_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/buckslips/${id}` }),
  });

  // Buckslip orders preview/commit
  const buckslipOrderPc = buildPreviewCommit({
    baseName: "lob_buckslip_orders",
    baseSchema: buckslipOrderCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => ({
        kind: "textual_preview",
        note:
          "Lob does not produce inventory-order proofs. This preview confirms validation only. The " +
          "returned confirmation_token binds the inventory_id and quantity — committing different values " +
          "will be rejected.",
        buckslip_id: payload.buckslip_id,
        quantity_ordered: payload.quantity_ordered,
        design_spec: findSpec("buckslip", "standard"),
      }),
      beforeDispatch: async (payload, serverCtx) => {
        const qty = Number(payload.quantity_ordered);
        pieceCounter.checkAndReserve(qty);
        const threshold = lob.env.requireElicitationForBulkOverPieces;
        if (threshold != null && qty > threshold) {
          await elicitOrFail(serverCtx as { mcpReq?: { elicitInput?: (req: unknown) => Promise<{ action: string; content?: unknown }> } } | undefined, {
            title: "Confirm bulk buckslip order",
            message: `About to order ${qty} buckslips. This is irreversible — Lob will print and stock the inventory.`,
          });
        }
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { buckslip_id, extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: `/buckslips/${buckslip_id}/orders`,
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(Number(payload.quantity_ordered));
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_buckslip_orders_preview",
    annotations: {
      title: "Preview a buckslip order",
      ...ToolAnnotationPresets.preview,
    },
    description:
      "Validate a buckslip-inventory-order payload and return a textual summary. Returns a " +
      "`confirmation_token` to pass to lob_buckslip_orders_create — required in live mode.",
    inputSchema: buckslipOrderCreateShape,
    handler: buckslipOrderPc.preview,
  });

  registerTool(server, {
    name: "lob_buckslip_orders_create",
    annotations: {
      title: "Order buckslip inventory (BILLABLE)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a buckslip-inventory order. **Billable** in live mode — Lob prints and stocks the " +
      "requested quantity. Requires a `confirmation_token` from lob_buckslip_orders_preview that " +
      "matches the current payload (live mode only). If LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES " +
      "is set and `quantity_ordered` exceeds it, an elicitation form must be confirmed.",
    inputSchema: buckslipOrderCommitShape,
    handler: buckslipOrderPc.commit,
  });

  registerTool(server, {
    name: "lob_buckslip_orders_list",
    annotations: { title: "List buckslip orders", ...ToolAnnotationPresets.read },
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
    annotations: { title: "Create a card", ...ToolAnnotationPresets.mutate },
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
    annotations: { title: "List cards", ...ToolAnnotationPresets.read },
    description: "List cards on your account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/cards", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_cards_get",
    annotations: { title: "Retrieve a card", ...ToolAnnotationPresets.read },
    description: "Retrieve a single card by ID.",
    inputSchema: { id: CARD_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/cards/${id}` }),
  });

  // Card orders preview/commit
  const cardOrderPc = buildPreviewCommit({
    baseName: "lob_card_orders",
    baseSchema: cardOrderCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => ({
        kind: "textual_preview",
        note:
          "Lob does not produce inventory-order proofs. This preview confirms validation only. The " +
          "returned confirmation_token binds the inventory_id and quantity.",
        card_id: payload.card_id,
        quantity: payload.quantity,
        design_spec: findSpec("card", "standard"),
      }),
      beforeDispatch: async (payload, serverCtx) => {
        const qty = Number(payload.quantity);
        pieceCounter.checkAndReserve(qty);
        const threshold = lob.env.requireElicitationForBulkOverPieces;
        if (threshold != null && qty > threshold) {
          await elicitOrFail(serverCtx as { mcpReq?: { elicitInput?: (req: unknown) => Promise<{ action: string; content?: unknown }> } } | undefined, {
            title: "Confirm bulk card order",
            message: `About to order ${qty} cards. This is irreversible — Lob will print and stock the inventory.`,
          });
        }
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { card_id, extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: `/cards/${card_id}/orders`,
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(Number(payload.quantity));
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_card_orders_preview",
    annotations: { title: "Preview a card order", ...ToolAnnotationPresets.preview },
    description:
      "Validate a card-inventory-order payload and return a textual summary. Returns a " +
      "`confirmation_token` to pass to lob_card_orders_create — required in live mode.",
    inputSchema: cardOrderCreateShape,
    handler: cardOrderPc.preview,
  });

  registerTool(server, {
    name: "lob_card_orders_create",
    annotations: {
      title: "Order card inventory (BILLABLE)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a card-inventory order. **Billable** in live mode — Lob prints and stocks the requested " +
      "quantity. Requires a `confirmation_token` from lob_card_orders_preview that matches the current " +
      "payload (live mode only). If LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES is set and `quantity` " +
      "exceeds it, an elicitation form must be confirmed.",
    inputSchema: cardOrderCommitShape,
    handler: cardOrderPc.commit,
  });

  registerTool(server, {
    name: "lob_card_orders_list",
    annotations: { title: "List card orders", ...ToolAnnotationPresets.read },
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
    annotations: {
      title: "List QR code analytics",
      ...ToolAnnotationPresets.read,
    },
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
      lob.request({
        method: "GET",
        path: "/qr_code_analytics",
        query: compact(args),
      }),
  });

  registerTool(server, {
    name: "lob_resource_proofs_create",
    annotations: { title: "Create a resource proof", ...ToolAnnotationPresets.mutate },
    description:
      "Create a proof — a PDF preview of how a resource (postcard, letter, self-mailer) will print — " +
      "for review before committing to a mail send. Pass `resource_parameters` with the same shape you " +
      "would pass to the underlying create endpoint (e.g. `{ front, back, to }` for a postcard). " +
      "Note: the `lob_*_preview` tools call this endpoint internally; this raw tool is exposed for " +
      "advanced use cases.",
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
      template_id: z
        .string()
        .optional()
        .describe("Optional template ID to associate with the proof."),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/resource_proofs",
        body: withExtra(rest, extra),
        keyMode: "test",
      });
    },
  });

  registerTool(server, {
    name: "lob_resource_proofs_get",
    annotations: {
      title: "Retrieve a resource proof",
      ...ToolAnnotationPresets.read,
    },
    description:
      "Retrieve a resource proof by ID, including a URL to download the proof PDF.",
    inputSchema: { id: RP_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/resource_proofs/${id}` }),
  });

  registerTool(server, {
    name: "lob_resource_proofs_update",
    annotations: {
      title: "Approve/reject a resource proof",
      ...ToolAnnotationPresets.mutate,
    },
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
