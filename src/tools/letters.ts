/**
 * Letter tools — preview / create / list / get / cancel. Letters mail in #10
 * double-window envelopes and support inserts (cards, buckslips), return
 * envelopes, perforation, and USPS extra services (certified, registered).
 *
 * `lob_letters_create` is BILLABLE; gated behind `lob_letters_preview` in live
 * mode. Preview renders against the test key via /resource_proofs.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import type { TokenStore } from "../preview/token-store.js";
import { buildPreviewCommit } from "../preview/preview-commit.js";
import type { PieceCounter } from "../safety/piece-counter.js";
import {
  compact,
  dateFilterSchema,
  extraParamsSchema,
  idempotencyKeyAutoSchema,
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
import { findSpec } from "../specs/manifest.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const LETTER_ID = z.string().regex(/^ltr_/).describe("Letter ID (`ltr_…`).");

const letterCreateShape = {
  ...mailPieceCommonShape,
  file: contentSourceSchema.describe(
    "Letter body content source (HTML, URL, template ID, or base64 PDF).",
  ),
  color: colorSchema,
  double_sided: doubleSidedSchema,
  address_placement: addressPlacementSchema,
  return_envelope: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe(
      "Include a return envelope. Boolean true for default, or a return envelope ID.",
    ),
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
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const letterCommitShape = {
  ...letterCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_letters_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

export function registerLetterTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  const pc = buildPreviewCommit({
    baseName: "lob_letters",
    baseSchema: letterCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => {
        const proof = (await lob.request({
          method: "POST",
          path: "/resource_proofs",
          body: {
            resource_type: "letter",
            resource_parameters: stripCommitOnly(payload),
          },
          keyMode: "test",
        })) as Record<string, unknown>;
        const variant = (payload as Record<string, unknown>).custom_envelope
          ? "custom_envelope"
          : "standard_no10";
        return { ...proof, design_spec: findSpec("letter", variant) };
      },
      beforeDispatch: async () => {
        pieceCounter.checkAndReserve(1);
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: "/letters",
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(1);
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_letters_preview",
    annotations: { title: "Preview a letter", ...ToolAnnotationPresets.preview },
    description:
      "Render a Lob proof PDF for a letter without charging or sending. Returns a `confirmation_token` " +
      "to pass to lob_letters_create. Required in live mode.",
    inputSchema: letterCreateShape,
    handler: pc.preview,
  });

  registerTool(server, {
    name: "lob_letters_create",
    annotations: {
      title: "Create a letter (BILLABLE)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a letter send. **Billable** in live mode. Requires a `confirmation_token` from " +
      "lob_letters_preview that matches the current payload (live mode only).",
    inputSchema: letterCommitShape,
    handler: pc.commit,
  });

  registerTool(server, {
    name: "lob_letters_list",
    annotations: { title: "List letters", ...ToolAnnotationPresets.read },
    description:
      "List letters on your Lob account, with cursor pagination and filtering.",
    inputSchema: {
      ...listParamsSchema.shape,
      mail_type: mailTypeSchema,
      color: z.boolean().optional(),
      scheduled: z.boolean().optional(),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/letters", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_letters_get",
    annotations: { title: "Retrieve a letter", ...ToolAnnotationPresets.read },
    description: "Retrieve a single letter by ID.",
    inputSchema: { id: LETTER_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/letters/${id}` }),
  });

  registerTool(server, {
    name: "lob_letters_cancel",
    annotations: {
      title: "Cancel a scheduled letter",
      ...ToolAnnotationPresets.destructive,
    },
    description:
      "Cancel a letter before its `send_date`. Production-locked letters cannot be cancelled.",
    inputSchema: { id: LETTER_ID },
    handler: async ({ id }) =>
      lob.request({ method: "DELETE", path: `/letters/${id}` }),
  });
}

function stripCommitOnly(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    idempotency_key: _i,
    extra: _e,
    confirmation_token: _t,
    ...rest
  } = payload;
  return rest;
}
