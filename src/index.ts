#!/usr/bin/env node
/**
 * lob-mcp entry point.
 *
 * Boots an MCP server over stdio that wraps the Lob.com API. Reads dual keys
 * (`LOB_TEST_API_KEY` required, `LOB_LIVE_API_KEY` optional) plus safety knobs
 * from the environment, prints a startup banner to stderr that reflects the
 * full safety posture, registers every tool, then connects the stdio transport.
 *
 * If invoked as `lob-mcp init`, runs the interactive setup wizard and exits
 * before any env loading happens.
 *
 * stderr is the only legal place to log here — stdout is reserved for the
 * JSON-RPC framed messages the MCP transport reads from the child process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runWizardIfRequested } from "./init/wizard.js";
import { loadEnv, type LobEnv } from "./env.js";
import { LobClient } from "./lob/client.js";
import { InMemoryTokenStore } from "./preview/token-store.js";
import { PieceCounter } from "./safety/piece-counter.js";
import { registerAllTools } from "./tools/register.js";
import { SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  if (await runWizardIfRequested(process.argv.slice(2))) return;

  const env = loadEnv();
  printBanner(env);

  const lob = new LobClient(env);
  const tokenStore = new InMemoryTokenStore();
  const pieceCounter = new PieceCounter(env.maxPiecesPerRun);

  const cleanupTimer = setInterval(() => tokenStore.cleanup(), 60_000);
  cleanupTimer.unref();

  const server = new McpServer(
    { name: "lob-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Lob MCP server. Preview/commit gated, idempotent, mode-aware.\n\n" +
        "FLOW:\n" +
        "• For mail-piece sends (postcards, letters, self-mailers, checks) and bulk inventory orders " +
        "(buckslips, cards), call `lob_<resource>_preview` first. The response includes a " +
        "`confirmation_token` and (for postcards/letters/self-mailers) a real Lob proof PDF URL.\n" +
        "• Then call `lob_<resource>_create` with the same payload plus `confirmation_token`. " +
        "In live mode the token is required; in test mode it is optional.\n\n" +
        "SAFETY:\n" +
        "• Default mode is TEST. To enable real mail and charges, set BOTH `LOB_LIVE_API_KEY` AND " +
        "`LOB_LIVE_MODE=true` in the server environment.\n" +
        "• `LOB_MAX_PIECES_PER_RUN` caps total pieces this process may create. Resets on restart.\n" +
        "• Address fields are PII — avoid echoing them unnecessarily into chat history.",
    },
  );

  registerAllTools(server, lob, tokenStore, pieceCounter);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lob-mcp] connected via stdio");
}

function printBanner(env: LobEnv): void {
  const live = env.effectiveMode === "live";
  console.error(
    live
      ? "[lob-mcp] LIVE mode — REAL physical mail and REAL charges will occur for billable commits."
      : "[lob-mcp] TEST mode — no real mail, no charges.",
  );
  if (env.liveApiKey && !env.liveModeEnabled) {
    console.error(
      "[lob-mcp]   ⚠ Live API key configured but LOB_LIVE_MODE != true — live key is dormant.",
    );
  }
  console.error("[lob-mcp] safety state:");
  console.error(
    `[lob-mcp]   • Confirmation required (live commits): ${env.requireConfirmation ? "yes" : "no"}`,
  );
  console.error(`[lob-mcp]   • Confirmation TTL: ${env.confirmationTtlSeconds}s`);
  console.error(
    `[lob-mcp]   • Max pieces per run: ${
      env.maxPiecesPerRun ?? "(no cap — consider setting LOB_MAX_PIECES_PER_RUN)"
    }`,
  );
  const checksThr = env.requireElicitationForChecksOverUsd;
  const bulkThr = env.requireElicitationForBulkOverPieces;
  console.error(
    `[lob-mcp]   • Elicitation: checks > $${checksThr ?? "(off)"}, bulk > ${
      bulkThr ?? "(off)"
    } pieces`,
  );
}

main().catch((err) => {
  console.error("[lob-mcp] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
