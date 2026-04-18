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
import { registerTool } from "./helpers.js";

const BANK_ID = z.string().regex(/^bank_/).describe("Bank account ID (`bank_…`).");

export function registerBankAccountTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_bank_accounts_create",
    annotations: { title: "Create a bank account", readOnlyHint: false },
    description:
      "Register a bank account that can be used to draw checks. Requires routing number, account " +
      "number, account type, and signatory. Bank accounts must be verified (`lob_bank_accounts_verify`) " +
      "before use in `lob_checks_create`.",
    inputSchema: {
      routing_number: z.string().regex(/^\d{9}$/).describe("9-digit US routing number."),
      account_number: z.string().describe("Account number."),
      account_type: z.enum(["company", "individual"]),
      signatory: z.string().max(100).describe("Name of authorized signer printed on checks."),
      description: z.string().max(255).optional(),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/bank_accounts",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_bank_accounts_list",
    annotations: { title: "List bank accounts", readOnlyHint: true, idempotentHint: true },
    description: "List bank accounts on your Lob account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/bank_accounts", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_bank_accounts_get",
    annotations: { title: "Retrieve a bank account", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single bank account by ID.",
    inputSchema: { id: BANK_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/bank_accounts/${id}` }),
  });

  registerTool(server, {
    name: "lob_bank_accounts_delete",
    annotations: {
      title: "Delete a bank account",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Remove a bank account. Pending checks drawn against it will continue to clear.",
    inputSchema: { id: BANK_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/bank_accounts/${id}` }),
  });

  registerTool(server, {
    name: "lob_bank_accounts_verify",
    annotations: { title: "Verify a bank account", readOnlyHint: false, idempotentHint: true },
    description:
      "Verify a bank account by submitting two micro-deposit amounts (in cents) that Lob deposited " +
      "into the account during registration. Required before the account can be used to draw checks.",
    inputSchema: {
      id: BANK_ID,
      amounts: z
        .tuple([z.number().int(), z.number().int()])
        .describe("Two micro-deposit amounts in cents, e.g. [11, 35]."),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/bank_accounts/${id}/verify`,
        body: withExtra(rest, extra),
      });
    },
  });
}
