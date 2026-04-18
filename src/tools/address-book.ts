import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import {
  compact,
  extraParamsSchema,
  inlineAddressSchema,
  listParamsSchema,
  metadataSchema,
  withExtra,
} from "../schemas/common.js";
import { registerTool } from "./helpers.js";

export function registerAddressBookTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_addresses_create",
    annotations: { title: "Save address to address book", readOnlyHint: false },
    description:
      "Save an address to the Lob address book so it can be reused by ID (`adr_…`) when " +
      "creating mail pieces. Stored addresses are NOT automatically verified — call " +
      "`lob_us_verifications_create` or `lob_intl_verifications_create` separately if needed.",
    inputSchema: {
      ...inlineAddressSchema.shape,
      description: z.string().max(500).optional().describe("Internal description of the address."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/addresses",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_addresses_list",
    annotations: { title: "List address book entries", readOnlyHint: true, idempotentHint: true },
    description: "List addresses stored in your Lob address book. Supports cursor pagination.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/addresses", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_addresses_get",
    annotations: { title: "Retrieve a saved address", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single saved address by ID.",
    inputSchema: { id: z.string().regex(/^adr_/).describe("Lob address ID (`adr_…`).") },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/addresses/${id}` }),
  });

  registerTool(server, {
    name: "lob_addresses_delete",
    annotations: {
      title: "Delete a saved address",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description:
      "Delete a saved address from the address book. Does not affect mail pieces already created with it.",
    inputSchema: { id: z.string().regex(/^adr_/).describe("Lob address ID to delete.") },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/addresses/${id}` }),
  });
}
