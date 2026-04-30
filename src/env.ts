/**
 * Environment loading and Lob test/live key handling.
 *
 * The 1.0 model uses TWO keys:
 *   • LOB_TEST_API_KEY (required) — used for previews via /resource_proofs and as
 *     the fallback for everything when no live key is configured.
 *   • LOB_LIVE_API_KEY (optional) — used for live-account work.
 *
 * Two effective modes route operations to the correct key:
 *   • effectiveCommitMode — gates BILLABLE COMMITS (the 6 mail-piece / inventory
 *     `*_create` tools). Goes "live" only when both LOB_LIVE_API_KEY AND
 *     LOB_LIVE_MODE=true are set. Default test.
 *   • effectiveReadMode — gates everything else (lists, gets, searches, cancels,
 *     deletes, non-billable creates/updates, verifications). Goes "live"
 *     whenever LOB_LIVE_API_KEY is configured — analytics questions like
 *     "how many letters last week?" are about real account data, and reads
 *     have no billing risk. Set LOB_READS_USE_TEST=true to force reads back
 *     onto the test key (uncommon — useful in dev environments where the live
 *     key is mounted but you want test responses).
 *
 * Previews always run against the test key regardless of either mode.
 */

export interface LobEnv {
  testApiKey: string;
  liveApiKey: string | null;
  apiVersion: string | undefined;
  baseUrl: string;
  /** True when LOB_LIVE_MODE=true AND a live key is configured. Drives commit gating. */
  liveModeEnabled: boolean;
  /** Routes billable commit POSTs. "live" only when liveModeEnabled. */
  effectiveCommitMode: "test" | "live";
  /** Routes everything that is NOT a billable commit. "live" whenever liveApiKey is set, unless LOB_READS_USE_TEST=true. */
  effectiveReadMode: "test" | "live";
  requireConfirmation: boolean;
  confirmationTtlSeconds: number;
  maxPiecesPerRun: number | null;
  requireElicitationForChecksOverUsd: number | null;
  requireElicitationForBulkOverPieces: number | null;
  /** Per-request HTTP timeout for outbound Lob calls, in milliseconds. */
  requestTimeoutMs: number;
}

const DEFAULT_BASE_URL = "https://api.lob.com/v1";
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

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
  const effectiveCommitMode: LobEnv["effectiveCommitMode"] = liveModeEnabled ? "live" : "test";

  const readsUseTest = parseBool(process.env.LOB_READS_USE_TEST, false);
  const effectiveReadMode: LobEnv["effectiveReadMode"] =
    liveApiKey && !readsUseTest ? "live" : "test";

  const baseUrl = (process.env.LOB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiVersion = process.env.LOB_API_VERSION?.trim() || undefined;

  const rawTimeout = process.env.LOB_REQUEST_TIMEOUT_MS;
  let requestTimeoutMs: number;
  if (rawTimeout === undefined || rawTimeout.trim() === "") {
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  } else {
    const parsed = Number(rawTimeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `LOB_REQUEST_TIMEOUT_MS must be a positive integer (ms), got '${rawTimeout}'.`,
      );
    }
    requestTimeoutMs = Math.floor(parsed);
  }

  return {
    testApiKey,
    liveApiKey: liveApiKey || null,
    apiVersion,
    baseUrl,
    liveModeEnabled,
    effectiveCommitMode,
    effectiveReadMode,
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
    requestTimeoutMs,
  };
}
