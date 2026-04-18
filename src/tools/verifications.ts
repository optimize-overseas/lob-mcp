/**
 * Address verification tools: US single + bulk, international single + bulk,
 * autocomplete, reverse geocode, identity validation. None of these produce
 * physical mail — they are pure lookups against Lob's verification corpus.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import { compact, extraParamsSchema, withExtra } from "../schemas/common.js";
import { registerTool } from "./helpers.js";

const usAddressInputSchema = {
  primary_line: z.string().describe("Primary street address line."),
  secondary_line: z.string().optional().describe("Apartment/suite/unit line."),
  urbanization: z.string().optional().describe("Puerto Rico urbanization, if applicable."),
  city: z.string().optional(),
  state: z.string().optional().describe("Two-letter US state code."),
  zip_code: z.string().optional().describe("5- or 9-digit ZIP."),
  /** Lob will accept either separated fields above OR a single `address` field. */
  address: z
    .string()
    .optional()
    .describe("Full single-line address, used instead of separated fields."),
  recipient: z.string().optional().describe("Recipient name."),
};

const intlAddressInputSchema = {
  primary_line: z.string().describe("Primary street address line."),
  secondary_line: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional().describe("State, province, or region."),
  postal_code: z.string().optional(),
  country: z.string().length(2).describe("Two-letter ISO country code."),
};

export function registerVerificationTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_us_verifications_create",
    annotations: { title: "Verify a US address", readOnlyHint: false, idempotentHint: true },
    description:
      "Verify, correct, and standardize a single US address. Returns deliverability status, " +
      "USPS-formatted components, geolocation (lat/lng), and county info.",
    inputSchema: {
      ...usAddressInputSchema,
      case: z
        .enum(["upper", "proper"])
        .optional()
        .describe("Casing to apply to returned components. Defaults to 'upper'."),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/us_verifications",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_us_verifications_get",
    annotations: { title: "Retrieve a US verification", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a previously-created US verification by ID.",
    inputSchema: { id: z.string().describe("US verification ID (`us_ver_…`).") },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/us_verifications/${id}` }),
  });

  registerTool(server, {
    name: "lob_us_autocompletions_create",
    annotations: { title: "Autocomplete a US address", readOnlyHint: false, idempotentHint: true },
    description:
      "Suggest completed US addresses from a partial input — useful for typeahead UX. Returns up to 10 suggestions.",
    inputSchema: {
      address_prefix: z.string().min(1).describe("Partial primary address line to autocomplete."),
      city: z.string().optional(),
      state: z.string().optional().describe("Two-letter US state code."),
      zip_code: z.string().optional(),
      geo_ip_sort: z
        .boolean()
        .optional()
        .describe("Sort suggestions by proximity to the requesting IP."),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/us_autocompletions",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_intl_verifications_create",
    annotations: { title: "Verify an international address", readOnlyHint: false, idempotentHint: true },
    description:
      "Verify a single non-US address. Returns deliverability status and standardized components for " +
      "the destination country.",
    inputSchema: {
      ...intlAddressInputSchema,
      address: z.string().optional().describe("Full single-line address (alternative to fields above)."),
      recipient: z.string().optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/intl_verifications",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_bulk_us_verifications_create",
    annotations: { title: "Bulk verify US addresses", readOnlyHint: false, idempotentHint: true },
    description:
      "Verify up to 1,000 US addresses in a single request. Returns one verification result per " +
      "input, in the same order.",
    inputSchema: {
      addresses: z.array(z.object(usAddressInputSchema).passthrough()).min(1).max(1000),
      case: z.enum(["upper", "proper"]).optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/bulk/us_verifications",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_bulk_intl_verifications_create",
    annotations: { title: "Bulk verify international addresses", readOnlyHint: false, idempotentHint: true },
    description: "Verify up to 1,000 non-US addresses in a single request.",
    inputSchema: {
      addresses: z.array(z.object(intlAddressInputSchema).passthrough()).min(1).max(1000),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/bulk/intl_verifications",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_reverse_geocode",
    annotations: { title: "Reverse geocode a coordinate", readOnlyHint: true, idempotentHint: true },
    description: "Look up the closest US ZIP+4 codes for a given latitude/longitude.",
    inputSchema: {
      location: z
        .string()
        .regex(/^-?\d+\.?\d*,-?\d+\.?\d*$/)
        .describe("Comma-separated 'lat,lng' string, e.g. '37.7749,-122.4194'."),
      size: z.number().int().min(1).max(50).optional().describe("Number of results (1–50)."),
    },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/reverse_geocode_lookups", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_identity_validation",
    annotations: { title: "Validate identity for an address", readOnlyHint: false, idempotentHint: true },
    description:
      "Validate a person/business name against a US address. Returns whether the recipient is " +
      "associated with the address.",
    inputSchema: {
      recipient: z.string().describe("Name to validate."),
      primary_line: z.string(),
      secondary_line: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip_code: z.string().optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/identity_validation",
        body: withExtra(rest, extra),
      });
    },
  });
}
