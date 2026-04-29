/**
 * Postcard tools — preview / create / list / get / cancel.
 *
 * `lob_postcards_create` is BILLABLE. The 1.0 model gates it behind a
 * `confirmation_token` from `lob_postcards_preview` whenever effective mode is
 * `live`. Preview always renders against the test key via `/resource_proofs`,
 * so a real PDF URL is returned regardless of whether live mode is enabled.
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
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { findSpec } from "../specs/manifest.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const POSTCARD_ID = z.string().regex(/^psc_/).describe("Postcard ID (`psc_…`).");
const POSTCARD_SIZE = z.enum(["4x6", "6x9", "6x11"]);

const postcardCreateShape = {
  ...mailPieceCommonShape,
  front: contentSourceSchema.describe("Front-of-postcard content source."),
  back: contentSourceSchema.describe("Back-of-postcard content source."),
  size: POSTCARD_SIZE.optional().describe("Postcard size. Defaults to 4x6."),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const postcardCommitShape = {
  ...postcardCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_postcards_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

export function registerPostcardTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  const pc = buildPreviewCommit({
    baseName: "lob_postcards",
    baseSchema: postcardCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => {
        const proof = (await lob.request({
          method: "POST",
          path: "/resource_proofs",
          body: {
            resource_type: "postcard",
            resource_parameters: stripCommitOnly(payload),
          },
          keyMode: "test",
        })) as Record<string, unknown>;
        const variant = (payload.size as string | undefined) ?? "4x6";
        return { ...proof, design_spec: findSpec("postcard", variant) };
      },
      beforeDispatch: async () => {
        pieceCounter.checkAndReserve(1);
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: "/postcards",
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(1);
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_postcards_preview",
    annotations: { title: "Preview a postcard", ...ToolAnnotationPresets.preview },
    description:
      "Render a Lob proof PDF for a postcard without charging or sending. Returns a `confirmation_token` " +
      "to pass to lob_postcards_create. The token is required in live mode (LOB_LIVE_MODE=true). " +
      "Token TTL: LOB_CONFIRMATION_TTL_SECONDS (default 600). Sizes: 4x6 (default), 6x9, 6x11.",
    inputSchema: postcardCreateShape,
    handler: pc.preview,
  });

  registerTool(server, {
    name: "lob_postcards_create",
    annotations: {
      title: "Create a postcard (BILLABLE)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a postcard send. **Billable** in live mode: produces real physical mail and is charged " +
      "to your Lob account. In live mode, requires a `confirmation_token` from lob_postcards_preview " +
      "that matches the current payload. In test mode, the token is optional (dev ergonomics).",
    inputSchema: postcardCommitShape,
    handler: pc.commit,
  });

  registerTool(server, {
    name: "lob_postcards_list",
    annotations: { title: "List postcards", ...ToolAnnotationPresets.read },
    description:
      "List postcards on your Lob account, with cursor pagination and filtering.",
    inputSchema: {
      ...listParamsSchema.shape,
      size: POSTCARD_SIZE.optional(),
      mail_type: mailTypeSchema,
      scheduled: z
        .boolean()
        .optional()
        .describe("Filter to scheduled-but-not-sent postcards."),
      send_date: dateFilterSchema.optional(),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/postcards", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_postcards_get",
    annotations: { title: "Retrieve a postcard", ...ToolAnnotationPresets.read },
    description: "Retrieve a single postcard by ID.",
    inputSchema: { id: POSTCARD_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/postcards/${id}` }),
  });

  registerTool(server, {
    name: "lob_postcards_cancel",
    annotations: {
      title: "Cancel a scheduled postcard",
      ...ToolAnnotationPresets.destructive,
    },
    description:
      "Cancel a postcard before its `send_date`. Only works while the postcard is still in a " +
      "cancellable state — production-locked pieces cannot be cancelled.",
    inputSchema: { id: POSTCARD_ID },
    handler: async ({ id }) =>
      lob.request({ method: "DELETE", path: `/postcards/${id}` }),
  });
}

/** Strip preview/commit-only fields before sending to Lob's create endpoint. */
function stripCommitOnly(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    idempotency_key: _i,
    extra: _e,
    confirmation_token: _t,
    ...rest
  } = payload;
  return rest;
}
