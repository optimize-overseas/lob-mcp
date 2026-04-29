/**
 * Self-mailer tools — preview / create / list / get / cancel.
 *
 * `lob_self_mailers_create` is BILLABLE; gated behind `lob_self_mailers_preview`
 * in live mode. Preview renders against the test key via /resource_proofs.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import type { TokenStore } from "../preview/token-store.js";
import { buildPreviewCommit } from "../preview/preview-commit.js";
import type { PieceCounter } from "../safety/piece-counter.js";
import {
  compact,
  extraParamsSchema,
  idempotencyKeyAutoSchema,
  listParamsSchema,
  mailTypeSchema,
  withExtra,
} from "../schemas/common.js";
import { contentSourceSchema, mailPieceCommonShape } from "../schemas/mail.js";
import { findSpec } from "../specs/manifest.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const SELF_MAILER_ID = z
  .string()
  .regex(/^sfm_/)
  .describe("Self-mailer ID (`sfm_…`).");
const SELF_MAILER_SIZE = z.enum(["6x18_bifold", "11x9_bifold"]);

const selfMailerCreateShape = {
  ...mailPieceCommonShape,
  inside: contentSourceSchema.describe("Inside-of-self-mailer content source."),
  outside: contentSourceSchema.describe("Outside-of-self-mailer content source."),
  size: SELF_MAILER_SIZE.optional().describe(
    "Self-mailer size. Defaults to 6x18_bifold.",
  ),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const selfMailerCommitShape = {
  ...selfMailerCreateShape,
  confirmation_token: z
    .string()
    .optional()
    .describe(
      "Token from lob_self_mailers_preview. Required in live mode (LOB_LIVE_MODE=true).",
    ),
} as const;

export function registerSelfMailerTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  const pc = buildPreviewCommit({
    baseName: "lob_self_mailers",
    baseSchema: selfMailerCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      renderPreview: async (payload) => {
        const proof = (await lob.request({
          method: "POST",
          path: "/resource_proofs",
          body: {
            resource_type: "self_mailer",
            resource_parameters: stripCommitOnly(payload),
          },
          keyMode: "test",
        })) as Record<string, unknown>;
        const variant = (payload.size as string | undefined) ?? "6x18_bifold";
        return { ...proof, design_spec: findSpec("self_mailer", variant) };
      },
      beforeDispatch: async () => {
        pieceCounter.checkAndReserve(1);
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: "/self_mailers",
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
        });
        pieceCounter.record(1);
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_self_mailers_preview",
    annotations: {
      title: "Preview a self-mailer",
      ...ToolAnnotationPresets.preview,
    },
    description:
      "Render a Lob proof PDF for a self-mailer without charging or sending. Returns a " +
      "`confirmation_token` to pass to lob_self_mailers_create. Required in live mode.",
    inputSchema: selfMailerCreateShape,
    handler: pc.preview,
  });

  registerTool(server, {
    name: "lob_self_mailers_create",
    annotations: {
      title: "Create a self-mailer (BILLABLE)",
      ...ToolAnnotationPresets.commit,
    },
    description:
      "Commit a self-mailer send. **Billable** in live mode. Requires a `confirmation_token` from " +
      "lob_self_mailers_preview that matches the current payload (live mode only). " +
      "Sizes: 6x18_bifold (default), 11x9_bifold.",
    inputSchema: selfMailerCommitShape,
    handler: pc.commit,
  });

  registerTool(server, {
    name: "lob_self_mailers_list",
    annotations: { title: "List self-mailers", ...ToolAnnotationPresets.read },
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
    annotations: { title: "Retrieve a self-mailer", ...ToolAnnotationPresets.read },
    description: "Retrieve a single self-mailer by ID.",
    inputSchema: { id: SELF_MAILER_ID },
    handler: async ({ id }) =>
      lob.request({ method: "GET", path: `/self_mailers/${id}` }),
  });

  registerTool(server, {
    name: "lob_self_mailers_cancel",
    annotations: {
      title: "Cancel a scheduled self-mailer",
      ...ToolAnnotationPresets.destructive,
    },
    description: "Cancel a self-mailer before its `send_date`.",
    inputSchema: { id: SELF_MAILER_ID },
    handler: async ({ id }) =>
      lob.request({ method: "DELETE", path: `/self_mailers/${id}` }),
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
