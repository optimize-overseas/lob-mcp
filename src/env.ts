/**
 * Environment loading and Lob test/live key handling.
 *
 * The 1.0 model uses TWO keys:
 *   • LOB_TEST_API_KEY (required) — used for previews via /resource_proofs and for
 *     all tool calls when live mode is not enabled.
 *   • LOB_LIVE_API_KEY (optional) — used for commits when LOB_LIVE_MODE=true.
 *
 * Effective mode determines what `*_create` calls actually do:
 *   • test  — no real mail, no charges. The default.
 *   • live  — real mail, real charges. Requires both LOB_LIVE_API_KEY AND LOB_LIVE_MODE=true.
 */

export interface LobEnv {
  testApiKey: string;
  liveApiKey: string | null;
  apiVersion: string | undefined;
  baseUrl: string;
  liveModeEnabled: boolean;
  /** What commits actually run against. Reads default to this too. */
  effectiveMode: "test" | "live";
  requireConfirmation: boolean;
  confirmationTtlSeconds: number;
  maxPiecesPerRun: number | null;
  requireElicitationForChecksOverUsd: number | null;
  requireElicitationForBulkOverPieces: number | null;
}

const DEFAULT_BASE_URL = "https://api.lob.com/v1";
const DEFAULT_TTL_SECONDS = 600;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parsePositiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function loadEnv(): LobEnv {
  let testApiKey = process.env.LOB_TEST_API_KEY?.trim() ?? "";
  const liveApiKey = process.env.LOB_LIVE_API_KEY?.trim() ?? "";

  // Soft-fallback for legacy LOB_API_KEY=test_… deployments.
  if (!testApiKey && process.env.LOB_API_KEY) {
    const legacy = process.env.LOB_API_KEY.trim();
    if (legacy.startsWith("test_")) {
      testApiKey = legacy;
    } else {
      throw new Error(
        "Legacy LOB_API_KEY=live_… is no longer accepted. Set LOB_TEST_API_KEY (required) " +
          "and LOB_LIVE_API_KEY (optional). See README 'Migration from 0.x'.",
      );
    }
  }

  if (!testApiKey) {
    throw new Error(
      "LOB_TEST_API_KEY is required (a Lob test_… key). Optionally also set LOB_LIVE_API_KEY " +
        "and LOB_LIVE_MODE=true to enable real mail. Run `npx lob-mcp init` for a guided setup.",
    );
  }
  if (!testApiKey.startsWith("test_")) {
    throw new Error(
      `LOB_TEST_API_KEY must start with test_ — got prefix '${testApiKey.slice(0, 5)}…'.`,
    );
  }
  if (liveApiKey && !liveApiKey.startsWith("live_")) {
    throw new Error(
      `LOB_LIVE_API_KEY must start with live_ — got prefix '${liveApiKey.slice(0, 5)}…'.`,
    );
  }

  const liveModeRequested = parseBool(process.env.LOB_LIVE_MODE, false);
  if (liveModeRequested && !liveApiKey) {
    throw new Error(
      "LOB_LIVE_MODE=true requires LOB_LIVE_API_KEY to be set with a live_… key.",
    );
  }
  const liveModeEnabled = liveModeRequested && Boolean(liveApiKey);
  const effectiveMode: LobEnv["effectiveMode"] = liveModeEnabled ? "live" : "test";

  const baseUrl = (process.env.LOB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiVersion = process.env.LOB_API_VERSION?.trim() || undefined;

  return {
    testApiKey,
    liveApiKey: liveApiKey || null,
    apiVersion,
    baseUrl,
    liveModeEnabled,
    effectiveMode,
    requireConfirmation: parseBool(process.env.LOB_REQUIRE_CONFIRMATION, true),
    confirmationTtlSeconds:
      parsePositiveNumber(process.env.LOB_CONFIRMATION_TTL_SECONDS) ?? DEFAULT_TTL_SECONDS,
    maxPiecesPerRun: parsePositiveNumber(process.env.LOB_MAX_PIECES_PER_RUN),
    requireElicitationForChecksOverUsd: parsePositiveNumber(
      process.env.LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD,
    ),
    requireElicitationForBulkOverPieces: parsePositiveNumber(
      process.env.LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES,
    ),
  };
}
