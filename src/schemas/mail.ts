/**
 * Schemas shared by mail-piece create endpoints (postcards, letters, self-mailers,
 * checks). Encapsulates the common create-shape — to/from addresses, content
 * sources, mail class, scheduling, metadata — so each resource file only has to
 * declare its resource-specific fields on top.
 */
import { z } from "zod";
import { addressRefSchema, mailTypeSchema, mergeVariablesSchema, sendDateSchema } from "./common.js";

export const fromAddressRefSchema = addressRefSchema.describe(
  "Sender (return) address. Either a saved address ID (`adr_…`) or an inline address.",
);

export const toAddressRefSchema = addressRefSchema.describe(
  "Recipient address. Either a saved address ID (`adr_…`) or an inline address.",
);

/**
 * HTML, a remote URL, a Lob template ID (`tmpl_…`), or a base64-encoded PDF.
 * Lob accepts any of these for content fields like `front`, `back`, `file`, `inside`, `outside`.
 */
export const contentSourceSchema = z
  .string()
  .describe(
    "Content source. Accepts: an HTML string, a fully-qualified https:// URL to an HTML/PDF asset, " +
      "a Lob template ID (`tmpl_…`), or a base64 data URI. See https://docs.lob.com for size limits.",
  );

export const colorSchema = z
  .boolean()
  .optional()
  .describe("Print in color (true) or black-and-white (false). Affects pricing.");

export const doubleSidedSchema = z
  .boolean()
  .optional()
  .describe("Print on both sides. Defaults to true for letters.");

export const addressPlacementSchema = z
  .enum(["top_first_page", "insert_blank_page"])
  .optional()
  .describe("Where the recipient address window appears on a letter.");

export const customEnvelopeSchema = z
  .object({
    id: z.string().describe("Lob envelope ID."),
  })
  .partial()
  .optional()
  .describe("Custom envelope reference for letters/checks.");

export const billingGroupIdSchema = z
  .string()
  .optional()
  .describe("Billing group ID (`bg_…`) to attribute the charge to.");

/** Common shape shared across all mail-piece create endpoints. */
export const mailPieceCommonShape = {
  description: z.string().max(255).optional().describe("Internal description (max 255 chars)."),
  to: toAddressRefSchema,
  from: fromAddressRefSchema,
  send_date: sendDateSchema,
  mail_type: mailTypeSchema,
  merge_variables: mergeVariablesSchema,
  metadata: z
    .record(z.string())
    .optional()
    .describe("Up to 20 string key/value pairs to attach to the resource."),
  billing_group_id: billingGroupIdSchema,
  use_type: z
    .enum(["marketing", "operational"])
    .optional()
    .describe("Required for some mail classes. 'marketing' for promotional, 'operational' for transactional."),
} as const;
