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
        "In live commit mode the token is required; in test mode it is optional.\n\n" +
        "SAFETY:\n" +
        "• Two modes route operations to the right key: COMMIT mode gates billable mail-piece sends " +
        "and inventory orders; READ mode covers everything else (lists, gets, searches, cancels, " +
        "non-billable creates). Commit mode is TEST unless BOTH `LOB_LIVE_API_KEY` AND `LOB_LIVE_MODE=true` " +
        "are set. Read mode is LIVE whenever `LOB_LIVE_API_KEY` is configured (set `LOB_READS_USE_TEST=true` " +
        "to opt out). Reads have no billing risk — analytics like 'how many letters last week?' should " +
        "see live data.\n" +
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
  const liveCommits = env.effectiveCommitMode === "live";
  const liveReads = env.effectiveReadMode === "live";
  console.error(
    `[lob-mcp] commits: ${
      liveCommits
        ? "LIVE — REAL physical mail and REAL charges for billable creates"
        : "TEST — no real mail, no charges"
    }`,
  );
  console.error(
    `[lob-mcp] reads:   ${
      liveReads
        ? "LIVE — list/get/search query the real account"
        : "TEST — list/get/search query the test account"
    }`,
  );
  if (env.liveApiKey && env.effectiveReadMode === "test") {
    console.error(
      "[lob-mcp]   ℹ LOB_READS_USE_TEST=true — reads forced to test key despite live key being configured.",
    );
  } else if (env.liveApiKey && !env.liveModeEnabled) {
    console.error(
      "[lob-mcp]   ℹ Live key configured, LOB_LIVE_MODE != true — commits stay test, reads use live.",
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
