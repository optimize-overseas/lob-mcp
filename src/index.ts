#!/usr/bin/env node
/**
 * lob-mcp entry point.
 *
 * Boots an MCP server over stdio that wraps the Lob.com API. Reads `LOB_API_KEY`
 * (and optional `LOB_API_VERSION`, `LOB_BASE_URL`) from the environment, prints a
 * one-line startup banner to stderr indicating test/live mode, registers all 76
 * tools, then connects the stdio transport.
 *
 * stderr is the only legal place to log here — stdout is reserved for the
 * JSON-RPC framed messages the MCP transport reads from the child process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv } from "./env.js";
import { LobClient } from "./lob/client.js";
import { registerAllTools } from "./tools/register.js";
import { SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const env = loadEnv();

  // stderr-only logging — stdout is reserved for the JSON-RPC transport.
  const modeNote =
    env.mode === "test"
      ? "TEST mode (test_ key) — no real mail will be produced."
      : env.mode === "live"
        ? "LIVE mode (live_ key) — mail-piece tools will produce REAL physical mail and bill your account."
        : "UNKNOWN key prefix — proceed carefully.";
  console.error(`[lob-mcp] starting in ${modeNote}`);

  const lob = new LobClient(env);

  const server = new McpServer(
    { name: "lob-mcp", version: SERVER_VERSION },
    {
      instructions:
        "MCP server for the Lob.com API. Provides tools to verify addresses and create physical mail " +
        "(postcards, letters, self-mailers, checks), manage templates, address book, campaigns, bank " +
        "accounts, tracking, and webhooks.\n\n" +
        "SAFETY:\n" +
        "• Mail-piece create tools (`lob_postcards_create`, `lob_letters_create`, `lob_self_mailers_create`, " +
        "`lob_checks_create`, `lob_*_orders_create`) are BILLABLE — they produce real physical mail and " +
        "incur Lob charges. Confirm with the user before calling these in LIVE mode.\n" +
        "• Always pass a unique `idempotency_key` (e.g. a UUID) on create calls so retries do not duplicate mail.\n" +
        "• Use a `test_…` API key during development; switch to `live_…` only when ready to ship real mail.\n" +
        "• Address fields are PII — avoid echoing them unnecessarily into chat history.",
    },
  );

  registerAllTools(server, lob);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lob-mcp] connected via stdio");
}

main().catch((err) => {
  console.error("[lob-mcp] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
