/**
 * Zod schemas shared across multiple resource groups: address payloads, list/
 * pagination params, idempotency, metadata, and the generic `extra` escape hatch
 * that lets callers pass any Lob field not enumerated in a tool schema.
 *
 * Also exports two payload-shaping helpers — `compact` (drop undefined keys) and
 * `withExtra` (merge user-provided extras under typed fields, with typed fields
 * taking precedence so the schema can't be silently overridden).
 */
import { z } from "zod";

/**
 * An inline US/international address payload accepted by Lob create endpoints.
 * Either provide a saved address `id` (`adr_…`) on the parent object, or this inline shape.
 */
export const inlineAddressSchema = z
  .object({
    name: z.string().max(40).optional().describe("Recipient name (max 40 chars)."),
    company: z.string().max(40).optional().describe("Company name (max 40 chars)."),
    address_line1: z.string().max(200).describe("Primary street address line."),
    address_line2: z.string().max(200).optional().describe("Apartment/suite/unit line."),
    address_city: z.string().max(200).optional(),
    address_state: z
      .string()
      .max(50)
      .optional()
      .describe("Two-letter US state code, or full state/province/region name for international."),
    address_zip: z.string().max(40).optional().describe("ZIP/postal code."),
    address_country: z
      .string()
      .length(2)
      .optional()
      .describe("Two-letter ISO country code. Omit or use 'US' for domestic."),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(100).optional(),
  })
  .describe("Inline address. At minimum, address_line1 plus city/state/zip (or country) are required by Lob.");

/** Either a Lob saved-address ID (`adr_…`) or an inline address object. */
export const addressRefSchema = z
  .union([
    z.string().regex(/^adr_/).describe("Existing Lob address ID."),
    inlineAddressSchema,
  ])
  .describe("A Lob saved-address ID (`adr_…`) or an inline address object.");

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(256)
  .optional()
  .describe(
    "Optional idempotency key. Forwarded as the `Idempotency-Key` header so retries do not duplicate billable mail. " +
      "Use a UUID per logical request and reuse it on retries.",
  );

/** Lob date-range filter shape: { gt, gte, lt, lte } each an ISO 8601 timestamp. */
export const dateFilterSchema = z
  .record(z.string())
  .describe("ISO8601 date filter object with gt/gte/lt/lte keys, e.g. { gt: '2026-01-01' }.");

export const listParamsSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("How many results to return (default 10, max 100)."),
    before: z.string().optional().describe("Cursor for the previous page."),
    after: z.string().optional().describe("Cursor for the next page."),
    include: z
      .array(z.string())
      .optional()
      .describe("Fields to include in the response, e.g. ['total_count']."),
    date_created: dateFilterSchema.optional(),
    metadata: z
      .record(z.string())
      .optional()
      .describe("Filter by metadata key/value pairs."),
  })
  .describe("Common Lob list/pagination parameters.");

export type ListParams = z.infer<typeof listParamsSchema>;

/** Generic escape hatch for Lob parameters not explicitly enumerated by a tool schema. */
export const extraParamsSchema = z
  .record(z.unknown())
  .optional()
  .describe(
    "Additional Lob API parameters not enumerated above. Merged into the request body verbatim. " +
      "See https://docs.lob.com for the full parameter list per resource.",
  );

export const sendDateSchema = z
  .string()
  .optional()
  .describe(
    "ISO 8601 timestamp (e.g. '2026-05-01T00:00:00Z') to schedule the send. " +
      "Must be at most 180 days in the future.",
  );

export const mailTypeSchema = z
  .enum(["usps_first_class", "usps_standard"])
  .optional()
  .describe("Mail class. Defaults to usps_first_class for most pieces.");

export const mergeVariablesSchema = z
  .record(z.unknown())
  .optional()
  .describe(
    "Key/value pairs substituted into Handlebars-style {{variables}} in your HTML/template content.",
  );

export const metadataSchema = z
  .record(z.string())
  .optional()
  .describe("Up to 20 string key/value pairs of arbitrary metadata to attach to the resource.");

/**
 * Strip undefined values from an object before sending. Lob treats explicit nulls and undefineds
 * differently in some places; we want clean payloads.
 */
export function compact<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** Merge an `extra` record into a typed payload, with explicit fields taking precedence. */
export function withExtra(
  payload: object,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(extra ?? {}), ...compact(payload) };
}
