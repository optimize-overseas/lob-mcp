# Lob-MCP Hardening Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to walk through subsystems sequentially. Steps use checkbox (`- [ ]`) syntax for tracking. **Final delivery is one squashed commit** at the end, but each subsystem must be smoke-tested before moving to the next.

**Goal:** Add a layered safety harness to the Lob MCP server — dual-key (test + optional live) configuration, preview/commit gating with payload binding, mandatory idempotency, complete tool annotations, exact-value piece caps, optional narrow elicitation for high-value sends, and an interactive setup wizard — so an LLM cannot inadvertently produce expensive or unwanted physical mail.

**Architecture:** The single `LOB_API_KEY` is replaced with `LOB_TEST_API_KEY` (required) and `LOB_LIVE_API_KEY` (optional). The `LobClient` carries both auth headers and routes per-call by `keyMode`. Previews always use the test key (so Lob's `/resource_proofs` returns a real renderable PDF for postcards/letters/self-mailers regardless of whether a live key is configured). Commits use the live key only when `LOB_LIVE_MODE=true` and a live key is present; otherwise commits also run against the test key (no real mail or charge). A pluggable `TokenStore` binds previewed payloads to commit calls. A `PieceCounter` enforces an exact `LOB_MAX_PIECES_PER_RUN` cap. A narrow `elicitOrFail` helper fires only when an exact-value threshold is crossed (check `amount` over USD threshold or bulk inventory `quantity` over piece threshold). A new `lob-mcp init` CLI wizard generates ready-to-paste host configs.

**Tech Stack:** TypeScript / Node 18+ / `@modelcontextprotocol/sdk@^1.22` / Zod v3 / built-in `node:test` + `tsx` for unit tests / `node:readline` for the wizard.

**Delivery:** One commit at the end. Heavy testing throughout: each subsystem smoke-tested via Inspector + unit tests before moving on. The final smoke target is **78 tools** (was 70 + 6 previews + 2 elicitation-aware variants are the same 6 commits, so really 76 — confirm during smoke).

**Live API testing advisory:** every subsystem can be developed and tested with only a test key. The single moment where a live key is helpful is the very end (Subsystem 8, final verification): one real $0.71 4x6 postcard to a maintainer's address to confirm end-to-end live behavior. Until then, no live key needed. The plan flags this explicitly when we get there.

---

## What changed since the prompt — the contemplations distilled

The original prompt assumed (a) Lob mode is per-request, (b) Lob returns prices in test mode, and (c) elicitation belongs everywhere over a dollar threshold. None of those hold once you check the docs. Decisions in this revision:

1. **Dual-key model replaces single-key + LOB_LIVE_MODE-refuses-live.** Preview always uses the test key (so `/resource_proofs` returns a real PDF for postcards/letters/self-mailers); commit uses live only when explicitly enabled. This solves the "preview rendering in test mode" problem cleanly without paradoxes.
2. **No estimated costs anywhere.** Lob doesn't return prices in either mode, and ginning up a static cost table creates more problems than it solves. The plan tracks **exact** values only (piece count, check `amount`, bulk-order `quantity`).
3. **Piece counter only — no dollar caps.** `LOB_MAX_PIECES_PER_RUN` is the single hard ceiling. Funds-drawn dollar caps removed entirely per direction.
4. **Elicitation is narrow + off by default.** Two env vars, both unset by default:
   - `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD` (uses exact `payload.amount`)
   - `LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES` (uses exact `quantity`/`quantity_ordered`)
   Per-piece sends (postcard/letter/self-mailer) rely on host destructiveHint + token binding alone — sufficient for sub-$1.50 exposure.
5. **Checks have no Lob proof endpoint.** Preview returns a textual summary (validated payload + address verification + amount + bank account confirmation). Token still binds the payload — the safety story is unchanged.
6. **Inventory orders (`buckslip_orders`, `card_orders`) also have no proofs.** Same textual-summary preview.
7. **Idempotency on every billable POST.** Auto-generated when not provided; deterministic from the confirmation token when present (so retries with the same token de-dupe at Lob).
8. **Tool annotation matrix complete and consistent across every tool.**
9. **`lob-mcp init` interactive setup wizard** that prompts for keys + caps and emits a ready-to-paste host config.
10. **Bump 0.1.4 → 1.0.0**, publish at the end after final smoke confirms.

---

## File structure (new + changed)

```
src/
├── env.ts                          # MODIFY: dual keys + safety env vars
├── index.ts                        # MODIFY: dual-key boot banner, plumb stores, wizard router
├── init/                           # NEW
│   └── wizard.ts                   # interactive setup wizard
├── lob/
│   ├── client.ts                   # MODIFY: dual auth headers + keyMode + idempotency assertion
│   ├── errors.ts                   # MODIFY: add LobMcpError + new error codes
│   └── redact.ts                   # unchanged
├── preview/                        # NEW
│   ├── token-store.ts              # TokenStore interface + InMemoryTokenStore
│   ├── payload-hash.ts             # canonical JSON + sha256 hash
│   ├── preview-record.ts           # types
│   └── preview-commit.ts           # buildPreviewCommit helper
├── safety/                         # NEW
│   ├── piece-counter.ts            # exact piece-count cap (no dollars)
│   └── elicit.ts                   # narrow elicitOrFail helper
├── schemas/
│   ├── common.ts                   # MODIFY: idempotencyKeyAutoSchema with UUID default
│   └── mail.ts                     # unchanged
└── tools/
    ├── helpers.ts                  # MODIFY: ToolAnnotationPresets + registerTool tweaks
    ├── register.ts                 # MODIFY: pass tokenStore + pieceCounter through
    ├── postcards.ts                # MODIFY: preview/commit via /resource_proofs
    ├── letters.ts                  # MODIFY: preview/commit via /resource_proofs
    ├── self-mailers.ts             # MODIFY: preview/commit via /resource_proofs
    ├── checks.ts                   # MODIFY: textual preview, elicitation if amount > threshold
    ├── uploads.ts                  # MODIFY: textual preview for orders, elicit if qty > threshold
    └── ...                         # other groups: annotation matrix only
tests/
└── unit/                           # NEW
    ├── token-store.test.ts
    ├── payload-hash.test.ts
    ├── preview-commit.test.ts
    ├── idempotency.test.ts
    ├── piece-counter.test.ts
    ├── env.test.ts                 # dual-key fallback behavior
    └── elicit.test.ts
docs/
└── superpowers/
    └── plans/2026-04-28-lob-mcp-hardening.md   # this file
package.json                                    # add `test` script + `tsx` dev dep + 1.0.0 bump
README.md                                       # rewrite Safety + Configuration sections
CHANGELOG.md                                    # NEW file
```

---

## Pre-flight: test runner

### Task 0.1: Add `node:test` runner via `tsx`

**Files:**
- Modify: `package.json`
- Create: `tests/unit/.gitkeep`

- [ ] **Step 1: Add the test script and dev dep**

In `package.json`:

```json
"scripts": {
  ...
  "test": "node --test --import tsx 'tests/unit/**/*.test.ts'"
},
"devDependencies": {
  ...
  "tsx": "^4.19.0"
}
```

Run: `npm install`
Expected: clean install.

- [ ] **Step 2: Verify empty runner passes**

Run: `mkdir -p tests/unit && touch tests/unit/.gitkeep && npm test`
Expected: "tests 0, pass 0, fail 0" — exit 0.

---

## Subsystem 1 — Dual-key env + LobClient

### Task 1.1: Replace `LOB_API_KEY` with `LOB_TEST_API_KEY` + `LOB_LIVE_API_KEY`

**Files:**
- Modify: `src/env.ts`
- Test: `tests/unit/env.test.ts`

**Decision:** soft-fallback for `test_…` legacy keys (smooth dev migration); hard error for legacy `live_…` keys (forces explicit two-key setup). Documented in the migration note.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/env.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../src/env.js";

beforeEach(() => {
  delete process.env.LOB_API_KEY;
  delete process.env.LOB_TEST_API_KEY;
  delete process.env.LOB_LIVE_API_KEY;
  delete process.env.LOB_LIVE_MODE;
  delete process.env.LOB_REQUIRE_CONFIRMATION;
  delete process.env.LOB_CONFIRMATION_TTL_SECONDS;
  delete process.env.LOB_MAX_PIECES_PER_RUN;
  delete process.env.LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD;
  delete process.env.LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES;
});

describe("loadEnv (dual-key)", () => {
  it("requires at least a test key", () => {
    assert.throws(() => loadEnv(), /LOB_TEST_API_KEY/);
  });

  it("test-only mode when only test key configured", () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    const e = loadEnv();
    assert.equal(e.testApiKey, "test_abc");
    assert.equal(e.liveApiKey, null);
    assert.equal(e.liveModeEnabled, false);
    assert.equal(e.effectiveMode, "test");
  });

  it("live-capable mode when both keys + LOB_LIVE_MODE=true", () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    process.env.LOB_LIVE_API_KEY = "live_xyz";
    process.env.LOB_LIVE_MODE = "true";
    const e = loadEnv();
    assert.equal(e.effectiveMode, "live");
  });

  it("live key present but LOB_LIVE_MODE not set → effective mode test", () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    process.env.LOB_LIVE_API_KEY = "live_xyz";
    const e = loadEnv();
    assert.equal(e.effectiveMode, "test");
  });

  it("rejects LOB_LIVE_MODE=true without a live key", () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    process.env.LOB_LIVE_MODE = "true";
    assert.throws(() => loadEnv(), /LOB_LIVE_API_KEY/);
  });

  it("legacy LOB_API_KEY=test_… is accepted as test key", () => {
    process.env.LOB_API_KEY = "test_legacy";
    const e = loadEnv();
    assert.equal(e.testApiKey, "test_legacy");
  });

  it("legacy LOB_API_KEY=live_… is rejected with migration message", () => {
    process.env.LOB_API_KEY = "live_legacy";
    assert.throws(() => loadEnv(), /LOB_TEST_API_KEY/);
  });

  it("rejects bad key prefixes", () => {
    process.env.LOB_TEST_API_KEY = "live_wrongslot";
    assert.throws(() => loadEnv(), /LOB_TEST_API_KEY must start with test_/);
  });

  it("parses cap and elicitation env vars", () => {
    process.env.LOB_TEST_API_KEY = "test_abc";
    process.env.LOB_MAX_PIECES_PER_RUN = "10";
    process.env.LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD = "1000";
    process.env.LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES = "500";
    const e = loadEnv();
    assert.equal(e.maxPiecesPerRun, 10);
    assert.equal(e.requireElicitationForChecksOverUsd, 1000);
    assert.equal(e.requireElicitationForBulkOverPieces, 500);
  });
});
```

Run: `npm test`
Expected: FAIL — env.ts doesn't export the new shape yet.

- [ ] **Step 2: Implement**

Replace `src/env.ts`:

```ts
export interface LobEnv {
  testApiKey: string;
  liveApiKey: string | null;
  apiVersion: string | undefined;
  baseUrl: string;
  liveModeEnabled: boolean;
  /** test or live — what commits actually use. Reads default to this too. */
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
  let liveApiKey = process.env.LOB_LIVE_API_KEY?.trim() ?? "";

  // Soft-fallback for legacy LOB_API_KEY=test_… deployments.
  if (!testApiKey && process.env.LOB_API_KEY) {
    const legacy = process.env.LOB_API_KEY.trim();
    if (legacy.startsWith("test_")) testApiKey = legacy;
    else
      throw new Error(
        "Legacy LOB_API_KEY=live_… is no longer accepted. Set LOB_TEST_API_KEY (required) " +
          "and LOB_LIVE_API_KEY (optional). See README 'Migration from 0.x'.",
      );
  }

  if (!testApiKey) {
    throw new Error(
      "LOB_TEST_API_KEY is required (a Lob test_… key). Optionally also set LOB_LIVE_API_KEY " +
        "and LOB_LIVE_MODE=true to enable real mail. See README.",
    );
  }
  if (!testApiKey.startsWith("test_")) {
    throw new Error(`LOB_TEST_API_KEY must start with test_ — got prefix '${testApiKey.slice(0, 5)}…'.`);
  }
  if (liveApiKey && !liveApiKey.startsWith("live_")) {
    throw new Error(`LOB_LIVE_API_KEY must start with live_ — got prefix '${liveApiKey.slice(0, 5)}…'.`);
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
```

Run: `npm test`
Expected: 9/9 tests pass.

### Task 1.2: Dual-key LobClient with keyMode routing + idempotency assertion

**Files:**
- Modify: `src/lob/client.ts`
- Test: `tests/unit/idempotency.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/idempotency.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LobClient } from "../../src/lob/client.js";
import type { LobEnv } from "../../src/env.js";

const baseEnv: LobEnv = {
  testApiKey: "test_xx",
  liveApiKey: "live_xx",
  apiVersion: undefined,
  baseUrl: "https://example.invalid",
  liveModeEnabled: true,
  effectiveMode: "live",
  requireConfirmation: true,
  confirmationTtlSeconds: 600,
  maxPiecesPerRun: null,
  requireElicitationForChecksOverUsd: null,
  requireElicitationForBulkOverPieces: null,
};

describe("LobClient", () => {
  it("throws on POST to billable paths without Idempotency-Key", async () => {
    const c = new LobClient(baseEnv);
    await assert.rejects(
      c.request({ method: "POST", path: "/postcards", body: { x: 1 } }),
      /Idempotency-Key required/,
    );
  });

  it("uses test auth header when keyMode='test'", async () => {
    const captured: Request[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Request(input as string, init));
      return new Response("{}", { status: 200 }) as unknown as Response;
    };
    try {
      const c = new LobClient(baseEnv);
      await c.request({ method: "GET", path: "/addresses", keyMode: "test" });
      const auth = captured[0].headers.get("authorization") ?? "";
      const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8");
      assert.match(decoded, /^test_xx:/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("uses live auth header when keyMode='live' and live key configured", async () => {
    const captured: Request[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Request(input as string, init));
      return new Response("{}", { status: 200 }) as unknown as Response;
    };
    try {
      const c = new LobClient(baseEnv);
      await c.request({ method: "GET", path: "/addresses", keyMode: "live" });
      const auth = captured[0].headers.get("authorization") ?? "";
      const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8");
      assert.match(decoded, /^live_xx:/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("falls back to test key when keyMode='live' but live key absent", async () => {
    const captured: Request[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Request(input as string, init));
      return new Response("{}", { status: 200 }) as unknown as Response;
    };
    try {
      const env = { ...baseEnv, liveApiKey: null, liveModeEnabled: false, effectiveMode: "test" as const };
      const c = new LobClient(env);
      await c.request({ method: "GET", path: "/addresses", keyMode: "live" });
      const auth = captured[0].headers.get("authorization") ?? "";
      const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8");
      assert.match(decoded, /^test_xx:/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

Run: `npm test`
Expected: FAIL on missing types/methods.

- [ ] **Step 2: Implement**

Modify `src/lob/client.ts` — replace the constructor and `request` to support dual keys + the assertion:

```ts
import { loadEnv, type LobEnv } from "../env.js";
import { USER_AGENT } from "../version.js";
import { LobApiError, type LobErrorBody } from "./errors.js";

export interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  idempotencyKey?: string | undefined;
  asForm?: boolean;
  lobVersion?: string | undefined;
  /** test = always test key. live = live key when configured, else falls back to test. Default: env.effectiveMode. */
  keyMode?: "test" | "live";
}

const BILLABLE_POST_PATHS = [
  /^\/postcards\b/,
  /^\/letters\b/,
  /^\/self_mailers\b/,
  /^\/checks\b/,
  /^\/buckslips\/[^/]+\/orders\b/,
  /^\/cards\/[^/]+\/orders\b/,
];

export class LobClient {
  readonly env: LobEnv;
  private readonly testAuth: string;
  private readonly liveAuth: string | null;

  constructor(env?: LobEnv) {
    this.env = env ?? loadEnv();
    this.testAuth = "Basic " + Buffer.from(`${this.env.testApiKey}:`, "utf8").toString("base64");
    this.liveAuth = this.env.liveApiKey
      ? "Basic " + Buffer.from(`${this.env.liveApiKey}:`, "utf8").toString("base64")
      : null;
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const requestedMode = opts.keyMode ?? this.env.effectiveMode;
    const auth = requestedMode === "live" && this.liveAuth ? this.liveAuth : this.testAuth;

    if (opts.method === "POST" && BILLABLE_POST_PATHS.some((rx) => rx.test(opts.path)) && !opts.idempotencyKey) {
      throw new Error(
        `Idempotency-Key required for POST ${opts.path}. This is a programmer bug — every billable ` +
          "create path must pass an idempotency key (use buildPreviewCommit or pass explicitly).",
      );
    }

    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    const version = opts.lobVersion ?? this.env.apiVersion;
    if (version) headers["Lob-Version"] = version;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let body: BodyInit | undefined;
    if (opts.body !== undefined && opts.method !== "GET" && opts.method !== "DELETE") {
      if (opts.asForm) {
        body = toFormData(opts.body);
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
    }

    const res = await fetch(url, { method: opts.method, headers, body });
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
    const json = text ? safeParse(text) : undefined;

    if (!res.ok) {
      const errBody = json as LobErrorBody | undefined;
      const message = errBody?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new LobApiError({
        status: res.status,
        message,
        code: errBody?.error?.code,
        requestId,
        body: json ?? text,
      });
    }
    return (json as T) ?? (undefined as T);
  }

  // ...buildUrl, safeParse, appendQuery, toFormData unchanged from current code...
}
```

Run: `npm test`
Expected: idempotency tests pass.

### Task 1.3: Add LobMcpError taxonomy

**Files:**
- Modify: `src/lob/errors.ts`

- [ ] **Step 1: Append to errors.ts**

```ts
export const LobMcpErrorCodes = {
  TOKEN_REQUIRED: "LOB_TOKEN_REQUIRED",
  TOKEN_NOT_FOUND: "LOB_TOKEN_NOT_FOUND",
  TOKEN_EXPIRED: "LOB_TOKEN_EXPIRED",
  TOKEN_PAYLOAD_MISMATCH: "LOB_TOKEN_PAYLOAD_MISMATCH",
  PIECE_CAP_EXCEEDED: "LOB_PIECE_CAP_EXCEEDED",
  CONFIRMATION_DECLINED: "LOB_CONFIRMATION_DECLINED",
} as const;
export type LobMcpErrorCode = typeof LobMcpErrorCodes[keyof typeof LobMcpErrorCodes];

export class LobMcpError extends Error {
  readonly code: LobMcpErrorCode;
  readonly nextStep?: string;
  constructor(code: LobMcpErrorCode, message: string, nextStep?: string) {
    super(message);
    this.name = "LobMcpError";
    this.code = code;
    this.nextStep = nextStep;
  }
}
```

Update `formatErrorForTool` to handle `LobMcpError` first:

```ts
export function formatErrorForTool(err: unknown): string {
  if (err instanceof LobMcpError) {
    return err.nextStep ? `${err.code}: ${err.message} Next: ${err.nextStep}` : `${err.code}: ${err.message}`;
  }
  if (err instanceof LobApiError) { /* unchanged */ }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return `Unknown error: ${safeStringify(err)}`;
}
```

Run: `npm run typecheck`
Expected: clean.

### Task 1.4: Subsystem 1 smoke

- [ ] **Step 1: Build + tools/list smoke**

Run:
```bash
npm run build
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | LOB_TEST_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log("tools:",JSON.parse(d).result.tools.length))'
```

Expected: `tools: 70` (still — we haven't added previews yet).

Note: `index.ts` won't compile yet because we haven't updated it — fix that here:

In `src/index.ts`, change references from `env.mode` and `env.apiKey` to the new shape. The mode-detection paragraph is dead — move on. Defer the rich banner to Subsystem 6.

```ts
// minimal index.ts adjustment to keep compilation green
import { loadEnv } from "./env.js";
import { LobClient } from "./lob/client.js";
// ...
const env = loadEnv();
console.error(`[lob-mcp] effective mode: ${env.effectiveMode}`);
const lob = new LobClient(env);
```

---

## Subsystem 2 — Preview/Commit

### Task 2.1: payload-hash module

**Files:**
- Create: `src/preview/payload-hash.ts`
- Test: `tests/unit/payload-hash.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPayload } from "../../src/preview/payload-hash.js";

describe("hashPayload", () => {
  it("returns same hash for reordered keys", () => {
    assert.equal(
      hashPayload({ to: "x", from: "y", amount: 1 }),
      hashPayload({ from: "y", amount: 1, to: "x" }),
    );
  });
  it("ignores idempotency_key and metadata", () => {
    assert.equal(
      hashPayload({ to: "x", idempotency_key: "k1", metadata: { a: "1" } }),
      hashPayload({ to: "x", idempotency_key: "k2", metadata: { a: "2" } }),
    );
  });
  it("differs when payload-relevant fields change", () => {
    assert.notEqual(hashPayload({ to: "x", amount: 1 }), hashPayload({ to: "x", amount: 2 }));
  });
  it("produces 64-char hex (SHA-256)", () => {
    assert.match(hashPayload({ x: 1 }), /^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/preview/payload-hash.ts
import { createHash } from "node:crypto";

const IGNORED_KEYS = new Set(["idempotency_key", "metadata", "confirmation_token"]);

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).filter((k) => !IGNORED_KEYS.has(k)).sort()) {
    if (obj[k] === undefined) continue;
    out[k] = canonical(obj[k]);
  }
  return out;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}
```

Run: `npm test`
Expected: 4/4 pass.

### Task 2.2: TokenStore

**Files:**
- Create: `src/preview/preview-record.ts`
- Create: `src/preview/token-store.ts`
- Test: `tests/unit/token-store.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTokenStore } from "../../src/preview/token-store.js";
import type { PreviewRecord } from "../../src/preview/preview-record.js";

function rec(overrides: Partial<PreviewRecord> = {}): PreviewRecord {
  const now = Date.now();
  return {
    token: "tok-1",
    toolName: "lob_postcards",
    payloadHash: "h",
    payload: {},
    previewResponse: {},
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

describe("InMemoryTokenStore", () => {
  it("put + get returns the stored record", () => {
    const s = new InMemoryTokenStore();
    s.put(rec());
    assert.equal(s.get("tok-1")?.token, "tok-1");
  });
  it("consume returns then deletes", () => {
    const s = new InMemoryTokenStore();
    s.put(rec());
    assert.equal(s.consume("tok-1")?.token, "tok-1");
    assert.equal(s.get("tok-1"), null);
  });
  it("consume on missing returns null", () => {
    assert.equal(new InMemoryTokenStore().consume("missing"), null);
  });
  it("get of expired returns null", () => {
    const s = new InMemoryTokenStore();
    s.put(rec({ expiresAt: Date.now() - 1 }));
    assert.equal(s.get("tok-1"), null);
  });
  it("consume of expired returns null", () => {
    const s = new InMemoryTokenStore();
    s.put(rec({ expiresAt: Date.now() - 1 }));
    assert.equal(s.consume("tok-1"), null);
  });
  it("cleanup removes expired", () => {
    const s = new InMemoryTokenStore();
    s.put(rec({ token: "a", expiresAt: Date.now() - 1 }));
    s.put(rec({ token: "b", expiresAt: Date.now() + 60_000 }));
    s.cleanup();
    assert.equal(s.get("a"), null);
    assert.equal(s.get("b")?.token, "b");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/preview/preview-record.ts
export interface PreviewRecord {
  token: string;
  toolName: string;
  payloadHash: string;
  payload: unknown;
  previewResponse: unknown;
  createdAt: number;
  expiresAt: number;
}
```

```ts
// src/preview/token-store.ts
import type { PreviewRecord } from "./preview-record.js";

export interface TokenStore {
  put(record: PreviewRecord): void;
  get(token: string): PreviewRecord | null;
  consume(token: string): PreviewRecord | null;
  cleanup(): void;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly records = new Map<string, PreviewRecord>();

  put(record: PreviewRecord): void {
    this.records.set(record.token, record);
  }
  get(token: string): PreviewRecord | null {
    const r = this.records.get(token);
    if (!r) return null;
    if (r.expiresAt <= Date.now()) {
      this.records.delete(token);
      return null;
    }
    return r;
  }
  consume(token: string): PreviewRecord | null {
    const r = this.records.get(token);
    if (!r) return null;
    if (r.expiresAt <= Date.now()) {
      this.records.delete(token);
      return null;
    }
    this.records.delete(token);
    return r;
  }
  cleanup(): void {
    const now = Date.now();
    for (const [t, r] of this.records.entries()) {
      if (r.expiresAt <= now) this.records.delete(t);
    }
  }
}
```

Run: `npm test`
Expected: pass.

### Task 2.3: buildPreviewCommit helper

**Files:**
- Create: `src/preview/preview-commit.ts`
- Test: `tests/unit/preview-commit.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { InMemoryTokenStore } from "../../src/preview/token-store.js";
import {
  buildPreviewCommit,
  type PreviewCommitContext,
} from "../../src/preview/preview-commit.js";
import type { LobEnv } from "../../src/env.js";

const testEnv: LobEnv = {
  testApiKey: "test_x", liveApiKey: null, apiVersion: undefined,
  baseUrl: "https://api.lob.com/v1", liveModeEnabled: false, effectiveMode: "test",
  requireConfirmation: true, confirmationTtlSeconds: 600,
  maxPiecesPerRun: null, requireElicitationForChecksOverUsd: null, requireElicitationForBulkOverPieces: null,
};
const liveEnv: LobEnv = { ...testEnv, liveApiKey: "live_y", liveModeEnabled: true, effectiveMode: "live" };

function makeCtx(env = testEnv): PreviewCommitContext {
  return {
    env,
    tokenStore: new InMemoryTokenStore(),
    renderPreview: async (payload) => ({ rendered: true, payload }),
    callCommit: async (payload, opts) => ({ ok: true, payload, idempotencyKey: opts.idempotencyKey }),
  };
}

const baseSchema = { to: z.string(), amount: z.number() } as const;

describe("buildPreviewCommit", () => {
  it("preview returns confirmation_token + expires_at + preview body", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx() });
    const r = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    assert.equal(typeof r.confirmation_token, "string");
    assert.ok((r.preview as Record<string, unknown>).rendered);
  });

  it("commit in live mode without token rejects with TOKEN_REQUIRED", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx(liveEnv) });
    await assert.rejects(pc.commit({ to: "x", amount: 1 }), /TOKEN_REQUIRED/);
  });

  it("commit in test mode without token works (dev ergonomics)", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx() });
    const r = (await pc.commit({ to: "x", amount: 1 })) as Record<string, unknown>;
    assert.equal((r.result as Record<string, unknown>).ok, true);
  });

  it("commit with valid token consumes it; second commit fails", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx(liveEnv) });
    const previewed = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    const tok = previewed.confirmation_token as string;
    await pc.commit({ to: "x", amount: 1, confirmation_token: tok });
    await assert.rejects(pc.commit({ to: "x", amount: 1, confirmation_token: tok }), /TOKEN_NOT_FOUND/);
  });

  it("commit with mutated payload rejects PAYLOAD_MISMATCH", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx(liveEnv) });
    const previewed = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    await assert.rejects(
      pc.commit({ to: "x", amount: 2, confirmation_token: previewed.confirmation_token as string }),
      /PAYLOAD_MISMATCH/,
    );
  });

  it("commit derives idempotency key from confirmation_token", async () => {
    const ctx = makeCtx(liveEnv);
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx });
    const previewed = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    const tok = previewed.confirmation_token as string;
    const r = (await pc.commit({ to: "x", amount: 1, confirmation_token: tok })) as Record<string, unknown>;
    const expected = `lob-mcp-${tok}`;
    assert.equal(r.idempotency_key_used, expected);
  });

  it("explicit idempotency_key wins over derivation", async () => {
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx: makeCtx(liveEnv) });
    const previewed = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    const r = (await pc.commit({
      to: "x", amount: 1,
      confirmation_token: previewed.confirmation_token as string,
      idempotency_key: "user-supplied-123",
    })) as Record<string, unknown>;
    assert.equal(r.idempotency_key_used, "user-supplied-123");
  });

  it("expired token fails with TOKEN_NOT_FOUND (treated same)", async () => {
    const ctx = makeCtx({ ...liveEnv, confirmationTtlSeconds: 0 });
    const pc = buildPreviewCommit({ baseName: "lob_postcards", baseSchema, ctx });
    const previewed = (await pc.preview({ to: "x", amount: 1 })) as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      pc.commit({ to: "x", amount: 1, confirmation_token: previewed.confirmation_token as string }),
      /TOKEN_NOT_FOUND/,
    );
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/preview/preview-commit.ts
import { randomUUID } from "node:crypto";
import type { ZodRawShape, infer as zInfer } from "zod";
import type { LobEnv } from "../env.js";
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";
import { hashPayload } from "./payload-hash.js";
import type { PreviewRecord } from "./preview-record.js";
import type { TokenStore } from "./token-store.js";

export interface PreviewCommitContext {
  env: LobEnv;
  tokenStore: TokenStore;
  renderPreview: (payload: Record<string, unknown>) => Promise<unknown>;
  callCommit: (
    payload: Record<string, unknown>,
    opts: { idempotencyKey: string; confirmationToken: string | undefined },
  ) => Promise<unknown>;
  /** Optional hook fired after token validation, before callCommit. Used for piece cap + elicitation. */
  beforeDispatch?: (payload: Record<string, unknown>, ctxArgs: unknown) => Promise<void>;
}

export interface PreviewCommitTools<TShape extends ZodRawShape> {
  preview: (input: { [K in keyof TShape]: zInfer<TShape[K]> }) => Promise<unknown>;
  commit: (
    input: { [K in keyof TShape]: zInfer<TShape[K]> } & {
      confirmation_token?: string;
      idempotency_key?: string;
    },
    serverCtx?: unknown,
  ) => Promise<unknown>;
}

export function buildPreviewCommit<TShape extends ZodRawShape>(opts: {
  baseName: string;
  baseSchema: TShape;
  ctx: PreviewCommitContext;
}): PreviewCommitTools<TShape> {
  const { baseName, ctx } = opts;

  return {
    async preview(input) {
      const payload = stripUndefined(input as Record<string, unknown>);
      const previewResponse = await ctx.renderPreview(payload);
      const token = randomUUID();
      const now = Date.now();
      const ttlMs = Math.max(0, ctx.env.confirmationTtlSeconds * 1000);
      const record: PreviewRecord = {
        token,
        toolName: baseName,
        payloadHash: hashPayload(payload),
        payload,
        previewResponse,
        createdAt: now,
        expiresAt: now + ttlMs,
      };
      ctx.tokenStore.put(record);
      return {
        confirmation_token: token,
        expires_at: new Date(record.expiresAt).toISOString(),
        preview: previewResponse,
      };
    },

    async commit(input, serverCtx) {
      const { confirmation_token, idempotency_key, ...rest } = input as Record<string, unknown>;
      const payload = stripUndefined(rest);

      const requireToken = ctx.env.requireConfirmation && ctx.env.effectiveMode === "live";

      let consumedToken: string | undefined;
      if (confirmation_token) {
        const record = ctx.tokenStore.consume(String(confirmation_token));
        if (!record) {
          throw new LobMcpError(
            LobMcpErrorCodes.TOKEN_NOT_FOUND,
            "Confirmation token not found, expired, or already consumed.",
            `Call ${baseName}_preview again to obtain a fresh token.`,
          );
        }
        if (hashPayload(payload) !== record.payloadHash) {
          throw new LobMcpError(
            LobMcpErrorCodes.TOKEN_PAYLOAD_MISMATCH,
            "Payload differs from previewed payload.",
            `Call ${baseName}_preview again with the current parameters.`,
          );
        }
        consumedToken = record.token;
      } else if (requireToken) {
        throw new LobMcpError(
          LobMcpErrorCodes.TOKEN_REQUIRED,
          "Live mode requires a confirmation_token.",
          `Call ${baseName}_preview with the same parameters to obtain a token.`,
        );
      }

      const idempotencyKey =
        (idempotency_key as string | undefined) ??
        (consumedToken ? `lob-mcp-${consumedToken}` : `lob-mcp-${randomUUID()}`);

      if (ctx.beforeDispatch) await ctx.beforeDispatch(payload, serverCtx);

      const result = await ctx.callCommit(payload, {
        idempotencyKey,
        confirmationToken: consumedToken,
      });

      return {
        idempotency_key_used: idempotencyKey,
        confirmation_token_consumed: consumedToken ?? null,
        result,
      };
    },
  };
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
```

Run: `npm test`
Expected: 8/8 preview-commit tests pass.

---

## Subsystem 3 — Piece counter

### Task 3.1: PieceCounter

**Files:**
- Create: `src/safety/piece-counter.ts`
- Test: `tests/unit/piece-counter.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PieceCounter } from "../../src/safety/piece-counter.js";

describe("PieceCounter", () => {
  it("permits within cap", () => {
    const c = new PieceCounter(5);
    c.checkAndReserve(3);
    c.record(3);
    c.checkAndReserve(2);
  });
  it("refuses over cap with PIECE_CAP_EXCEEDED", () => {
    const c = new PieceCounter(5);
    c.checkAndReserve(3);
    c.record(3);
    assert.throws(() => c.checkAndReserve(3), /PIECE_CAP_EXCEEDED/);
  });
  it("null cap permits unlimited", () => {
    const c = new PieceCounter(null);
    c.checkAndReserve(1_000_000);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/safety/piece-counter.ts
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";

export class PieceCounter {
  private sent = 0;
  constructor(private readonly cap: number | null) {}

  checkAndReserve(pieces: number): void {
    if (this.cap == null) return;
    if (this.sent + pieces > this.cap) {
      throw new LobMcpError(
        LobMcpErrorCodes.PIECE_CAP_EXCEEDED,
        `Sending ${pieces} more piece(s) would exceed LOB_MAX_PIECES_PER_RUN (${this.cap}). Sent so far this run: ${this.sent}.`,
        "Restart the server (counter resets) or raise LOB_MAX_PIECES_PER_RUN.",
      );
    }
  }

  record(pieces: number): void {
    this.sent += pieces;
  }

  state() { return { sent: this.sent, cap: this.cap }; }
}
```

Run: `npm test`
Expected: 3/3 pass.

---

## Subsystem 4 — Narrow elicitation

### Task 4.1: elicitOrFail helper

**Files:**
- Create: `src/safety/elicit.ts`
- Test: `tests/unit/elicit.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { elicitOrFail } from "../../src/safety/elicit.js";

describe("elicitOrFail", () => {
  it("passes when client accepts", async () => {
    const ctx = {
      mcpReq: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    };
    await elicitOrFail(ctx, { message: "Confirm", title: "x" });
  });
  it("throws CONFIRMATION_DECLINED when user declines", async () => {
    const ctx = { mcpReq: { elicitInput: async () => ({ action: "decline" }) } };
    await assert.rejects(elicitOrFail(ctx, { message: "x", title: "y" }), /CONFIRMATION_DECLINED/);
  });
  it("throws CONFIRMATION_DECLINED when client doesn't support elicitation", async () => {
    await assert.rejects(elicitOrFail({}, { message: "x", title: "y" }), /CONFIRMATION_DECLINED/);
  });
  it("throws CONFIRMATION_DECLINED when accept body says confirm:false", async () => {
    const ctx = {
      mcpReq: { elicitInput: async () => ({ action: "accept", content: { confirm: false } }) },
    };
    await assert.rejects(elicitOrFail(ctx, { message: "x", title: "y" }), /CONFIRMATION_DECLINED/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/safety/elicit.ts
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";

export interface ElicitArgs {
  title: string;
  message: string;
}

interface MaybeMcpReq {
  mcpReq?: {
    elicitInput?: (req: unknown) => Promise<{ action: string; content?: unknown }>;
  };
}

export async function elicitOrFail(serverCtx: MaybeMcpReq, args: ElicitArgs): Promise<void> {
  const elicit = serverCtx.mcpReq?.elicitInput;
  if (!elicit) {
    throw new LobMcpError(
      LobMcpErrorCodes.CONFIRMATION_DECLINED,
      "Client does not support MCP elicitation, but a confirmation is required for this send.",
      "Use a client that supports elicitation, or unset the relevant LOB_REQUIRE_ELICITATION_* env var.",
    );
  }
  const result = await elicit({
    mode: "form",
    message: args.message,
    requestedSchema: {
      type: "object",
      title: args.title,
      properties: { confirm: { type: "boolean", title: "I confirm this billable send" } },
      required: ["confirm"],
    },
  });
  const confirmed = result.action === "accept" && (result.content as Record<string, unknown> | undefined)?.confirm === true;
  if (!confirmed) {
    throw new LobMcpError(
      LobMcpErrorCodes.CONFIRMATION_DECLINED,
      "User declined the high-value send confirmation.",
    );
  }
}
```

Run: `npm test`
Expected: 4/4 pass.

---

## Subsystem 5 — Wire it all into the tool layer

### Task 5.1: Schemas + helpers + register signature

**Files:**
- Modify: `src/schemas/common.ts`
- Modify: `src/tools/helpers.ts`
- Modify: `src/tools/register.ts`

- [ ] **Step 1: idempotencyKeyAutoSchema**

In `src/schemas/common.ts`, alongside existing `idempotencyKeySchema`:

```ts
import { randomUUID } from "node:crypto";

export const idempotencyKeyAutoSchema = z
  .string()
  .min(1)
  .max(256)
  .optional()
  .describe(
    "Idempotency key (max 256 chars). If omitted, the server auto-generates a value derived from the " +
      "confirmation_token (or a fresh UUID). Lob deduplicates identical keys for 24 hours.",
  );
```

- [ ] **Step 2: ToolAnnotationPresets**

In `src/tools/helpers.ts`:

```ts
export const ToolAnnotationPresets = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  preview: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  commit: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  destructive: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  mutate: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;
```

Also: thread `serverCtx` to handlers. The MCP SDK passes a context object as the second argument; surface it:

```ts
(async (args: unknown, ctx: unknown): Promise<CallToolResult> => {
  try {
    const result = await def.handler(args as never, ctx);
    return { content: [{ type: "text", text: stringifyResult(result) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: formatErrorForTool(err) }] };
  }
}) as never,
```

Update `ToolDefinition.handler` signature to accept the optional ctx:

```ts
handler: (args: { [K in keyof TShape]: zInfer<TShape[K]> }, ctx?: unknown) => Promise<unknown>;
```

- [ ] **Step 3: registerAllTools signature**

```ts
// src/tools/register.ts
export function registerAllTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void { /* ... */ }
```

Pass `tokenStore` and `pieceCounter` only to billable groups (postcards, letters, self-mailers, checks, uploads). Other groups keep the current signature.

### Task 5.2: Wire postcards (proof preview via /resource_proofs)

**Files:**
- Modify: `src/tools/postcards.ts`

- [ ] **Step 1: Replace registerPostcardTools**

Outline (full code follows the same pattern across letters/self-mailers/checks/uploads):

```ts
import { buildPreviewCommit } from "../preview/preview-commit.js";
import type { TokenStore } from "../preview/token-store.js";
import { PieceCounter } from "../safety/piece-counter.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";

const POSTCARD_ID = z.string().regex(/^psc_/).describe("Postcard ID (`psc_…`).");
const POSTCARD_SIZE = z.enum(["4x6", "6x9", "6x11"]);

const postcardCreateShape = {
  ...mailPieceCommonShape,
  front: contentSourceSchema.describe("Front-of-postcard content source."),
  back: contentSourceSchema.describe("Back-of-postcard content source."),
  size: POSTCARD_SIZE.optional().describe("Postcard size. Defaults to 4x6."),
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

export function registerPostcardTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  const pc = buildPreviewCommit({
    baseName: "lob_postcards",
    baseSchema: postcardCreateShape,
    ctx: {
      env: lob.env,
      tokenStore,
      // Always render via test key against /resource_proofs.
      renderPreview: async (payload) => {
        return lob.request({
          method: "POST",
          path: "/resource_proofs",
          body: { resource_type: "postcard", resource_parameters: stripCommitOnly(payload) },
          keyMode: "test",
        });
      },
      beforeDispatch: async () => {
        pieceCounter.checkAndReserve(1);
      },
      callCommit: async (payload, { idempotencyKey }) => {
        const { extra, ...rest } = payload as Record<string, unknown>;
        const out = await lob.request({
          method: "POST",
          path: "/postcards",
          body: withExtra(rest, extra as Record<string, unknown> | undefined),
          idempotencyKey,
          // Default keyMode tracks env.effectiveMode — live when LIVE_MODE on, else test.
        });
        pieceCounter.record(1);
        return out;
      },
    },
  });

  registerTool(server, {
    name: "lob_postcards_preview",
    annotations: { title: "Preview a postcard", ...ToolAnnotationPresets.preview },
    description:
      "Render a Lob proof PDF for a postcard without charging or sending. Returns a confirmation_token " +
      "you must pass to lob_postcards_create in live mode. Token TTL: LOB_CONFIRMATION_TTL_SECONDS (default 600).",
    inputSchema: postcardCreateShape,
    handler: pc.preview,
  });

  registerTool(server, {
    name: "lob_postcards_create",
    annotations: { title: "Create a postcard (BILLABLE)", ...ToolAnnotationPresets.commit },
    description:
      "Commit a postcard send. Billable in live mode. In live mode, requires a confirmation_token " +
      "from lob_postcards_preview that matches the current payload.",
    inputSchema: {
      ...postcardCreateShape,
      confirmation_token: z.string().optional().describe("Token from lob_postcards_preview. Required in live mode."),
    },
    handler: pc.commit,
  });

  // list / get / cancel — keep existing registrations, update annotations to ToolAnnotationPresets.read / .destructive.
}

function stripCommitOnly(payload: Record<string, unknown>): Record<string, unknown> {
  const { idempotency_key: _i, extra: _e, confirmation_token: _t, ...rest } = payload;
  return rest;
}
```

- [ ] **Step 2: Smoke**

```bash
npm run build
LOB_TEST_API_KEY=test_x LOB_MAX_PIECES_PER_RUN=2 npm run inspector
```

In Inspector:
1. `lob_postcards_preview` with a real payload → expect a `confirmation_token` and `preview` containing a Lob `url`.
2. `lob_postcards_create` with that token + same payload → success.
3. Same token reused → `LOB_TOKEN_NOT_FOUND`.
4. Mutated payload → `LOB_TOKEN_PAYLOAD_MISMATCH`.
5. Issue 3 commits → expect 3rd to fail with `LOB_PIECE_CAP_EXCEEDED`.

Tools list count: 71.

### Task 5.3: Wire letters and self-mailers (same pattern)

**Files:**
- Modify: `src/tools/letters.ts`, `src/tools/self-mailers.ts`

- [ ] **Step 1: Apply identical pattern**

For letters, `resource_type: "letter"`. For self-mailers, `resource_type: "self_mailer"`. Schema shape from the existing `*_create` definitions (minus the inline annotations override). Pass `pieceCounter` and `tokenStore` through.

- [ ] **Step 2: Inspector smoke each**

Tools list after both: 73.

### Task 5.4: Wire checks (textual preview + check-amount elicitation)

**Files:**
- Modify: `src/tools/checks.ts`

- [ ] **Step 1: Implement**

```ts
const checkCreateShape = {
  ...mailPieceCommonShape,
  bank_account: z.string().regex(/^bank_/),
  amount: z.number().positive(),
  // …existing fields…
  idempotency_key: idempotencyKeyAutoSchema,
  extra: extraParamsSchema,
} as const;

const pc = buildPreviewCommit({
  baseName: "lob_checks",
  baseSchema: checkCreateShape,
  ctx: {
    env: lob.env,
    tokenStore,
    renderPreview: async (payload) => ({
      kind: "textual_preview",
      note: "Lob does not produce check proofs. Token still binds the payload — committing a different amount or recipient will be rejected.",
      bank_account: payload.bank_account,
      amount_usd: payload.amount,
      check_number: payload.check_number ?? "auto-assigned",
      memo: payload.memo,
    }),
    beforeDispatch: async (payload, serverCtx) => {
      pieceCounter.checkAndReserve(1);
      const threshold = lob.env.requireElicitationForChecksOverUsd;
      if (threshold != null && Number(payload.amount) > threshold) {
        await elicitOrFail(serverCtx as { mcpReq?: { elicitInput: (req: unknown) => Promise<{ action: string; content?: unknown }> } }, {
          title: "Confirm large check",
          message:
            `About to commit a $${Number(payload.amount).toFixed(2)} check from bank account ${payload.bank_account}. ` +
            `This is irreversible: physical mail will be produced and the amount will be drawn from the linked account when cashed.`,
        });
      }
    },
    callCommit: async (payload, { idempotencyKey }) => {
      const { extra, ...rest } = payload as Record<string, unknown>;
      const out = await lob.request({
        method: "POST",
        path: "/checks",
        body: withExtra(rest, extra as Record<string, unknown> | undefined),
        idempotencyKey,
      });
      pieceCounter.record(1);
      return out;
    },
  },
});
```

- [ ] **Step 2: Smoke (test mode)**

In Inspector with `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD=100`:
1. Preview a $50 check → returns textual preview + token.
2. Commit → succeeds (under threshold, no elicitation).
3. Preview a $500 check → returns textual preview + token.
4. Commit → Inspector pops the elicitation form. Approve → succeeds. Decline → `LOB_CONFIRMATION_DECLINED`.

Tools list: 74.

### Task 5.5: Wire buckslip_orders + card_orders (textual preview + bulk elicitation)

**Files:**
- Modify: `src/tools/uploads.ts`

- [ ] **Step 1: Apply pattern**

Same shape, but:

```ts
beforeDispatch: async (payload, serverCtx) => {
  const qty = Number((payload as Record<string, unknown>).quantity_ordered ?? (payload as Record<string, unknown>).quantity ?? 1);
  pieceCounter.checkAndReserve(qty);
  const threshold = lob.env.requireElicitationForBulkOverPieces;
  if (threshold != null && qty > threshold) {
    await elicitOrFail(serverCtx as ..., {
      title: "Confirm bulk order",
      message: `About to commit a bulk order of ${qty} pieces.`,
    });
  }
},
callCommit: async (payload, { idempotencyKey }) => {
  // ...
  pieceCounter.record(qty);
  return out;
},
```

- [ ] **Step 2: Smoke**

Tools list: 76.

### Task 5.6: Apply ToolAnnotationPresets to every other tool

**Files:**
- Modify: `src/tools/address-book.ts`, `verifications.ts`, `templates.ts`, `campaigns.ts`, `bank-accounts.ts`, `webhooks.ts`, plus the read-only registrations in postcards/letters/self-mailers/checks/uploads.

- [ ] **Step 1: Walk every registerTool**

Replace each `annotations: { … }` block with `annotations: { title: "…", ...ToolAnnotationPresets.<preset> }`. Match the matrix from the prompt:

| Tool category | preset |
|---|---|
| `*_verify`, `*_list`, `*_get`, `*_track`, `*_search` | `read` |
| `*_preview` | `preview` |
| `*_create` (commit), `*_orders_create` | `commit` |
| `*_create` (non-billable: address-book, templates, campaigns, creatives, buckslips/cards uploads, bank-accounts, webhooks) | `mutate` |
| `*_update` | `mutate` |
| `*_cancel`, `*_delete` | `destructive` |

- [ ] **Step 2: Smoke**

Tools list: 76 (unchanged from 5.5; this is annotation-only).

---

## Subsystem 6 — Plumb stores into index.ts + rich boot banner

### Task 6.1: index.ts wiring

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace main()**

```ts
#!/usr/bin/env node
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
  // Allow `lob-mcp init` to short-circuit before env loading.
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
        "Lob MCP server. Preview/commit gated, idempotent, mode-aware. Use lob_*_preview before lob_*_create " +
        "in live mode. See README for the safety env vars.",
    },
  );

  registerAllTools(server, lob, tokenStore, pieceCounter);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lob-mcp] connected via stdio");
}

function printBanner(env: LobEnv): void {
  const live = env.effectiveMode === "live";
  const lines: string[] = [];
  lines.push(
    live
      ? "[lob-mcp] LIVE mode — REAL physical mail and REAL charges will occur."
      : "[lob-mcp] TEST mode — no real mail, no charges.",
  );
  if (env.liveApiKey && !env.liveModeEnabled) {
    lines.push("[lob-mcp]   ⚠ Live API key configured but LOB_LIVE_MODE != true. Live key is dormant.");
  }
  lines.push(`[lob-mcp]   • Confirmation required (live commits): ${env.requireConfirmation ? "yes" : "no"}`);
  lines.push(`[lob-mcp]   • Confirmation TTL: ${env.confirmationTtlSeconds}s`);
  lines.push(
    `[lob-mcp]   • Max pieces per run: ${env.maxPiecesPerRun ?? "(no cap — consider setting LOB_MAX_PIECES_PER_RUN)"}`,
  );
  lines.push(
    `[lob-mcp]   • Elicitation: checks > $${env.requireElicitationForChecksOverUsd ?? "(off)"}, bulk > ${env.requireElicitationForBulkOverPieces ?? "(off)"} pieces`,
  );
  for (const line of lines) console.error(line);
}

main().catch((err) => {
  console.error("[lob-mcp] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke**

Run various env combinations and inspect the banner:

```bash
npm run build
LOB_TEST_API_KEY=test_x node build/index.js < /dev/null 2>&1 | head -10
LOB_TEST_API_KEY=test_x LOB_LIVE_API_KEY=live_y node build/index.js < /dev/null 2>&1 | head -10
LOB_TEST_API_KEY=test_x LOB_LIVE_API_KEY=live_y LOB_LIVE_MODE=true LOB_MAX_PIECES_PER_RUN=10 node build/index.js < /dev/null 2>&1 | head -10
```

Expected: each banner reflects the right state.

---

## Subsystem 7 — Setup wizard

### Task 7.1: `lob-mcp init`

**Files:**
- Create: `src/init/wizard.ts`

- [ ] **Step 1: Implement**

```ts
// src/init/wizard.ts
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function runWizardIfRequested(argv: string[]): Promise<boolean> {
  if (argv[0] !== "init") return false;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log("\nlob-mcp setup wizard\n--------------------\n");
  const testKey = (await rl.question("Lob TEST API key (test_…): ")).trim();
  if (!testKey.startsWith("test_")) {
    console.error("Error: test key must start with test_");
    rl.close();
    process.exit(1);
  }
  const liveKey = (await rl.question("Lob LIVE API key (live_…), or leave blank: ")).trim();
  const enableLive =
    liveKey && (await rl.question("Enable live mode now? (y/N): ")).trim().toLowerCase() === "y";
  const maxPieces = (
    await rl.question("Max pieces per run (recommended: 10 for personal use, blank for none): ")
  ).trim();
  const elicitChecks = (
    await rl.question("Elicit confirmation for checks over $ (blank for off): ")
  ).trim();
  const elicitBulk = (
    await rl.question("Elicit confirmation for bulk orders over N pieces (blank for off): ")
  ).trim();
  rl.close();

  const env: Record<string, string> = { LOB_TEST_API_KEY: testKey };
  if (liveKey) env.LOB_LIVE_API_KEY = liveKey;
  if (enableLive) env.LOB_LIVE_MODE = "true";
  if (maxPieces) env.LOB_MAX_PIECES_PER_RUN = maxPieces;
  if (elicitChecks) env.LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD = elicitChecks;
  if (elicitBulk) env.LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES = elicitBulk;

  console.log("\nClaude Desktop config snippet (add under mcpServers in claude_desktop_config.json):\n");
  console.log(JSON.stringify({ lob: { command: "npx", args: ["-y", "lob-mcp"], env } }, null, 2));
  console.log("\nClaude Code one-liner:\n");
  const cliEnv = Object.entries(env).map(([k, v]) => `--env ${k}=${v}`).join(" ");
  console.log(`claude mcp add lob ${cliEnv} -- npx -y lob-mcp\n`);
  return true;
}
```

- [ ] **Step 2: Smoke**

Run: `npm run build && node build/index.js init < /dev/tty`

Walk through prompts. Confirm output JSON looks right.

---

## Subsystem 8 — Documentation, version bump, publish

### Task 8.1: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite Configuration + Safety sections**

Replace the existing top warning + Configuration table with content that reflects:
- Dual-key model (`LOB_TEST_API_KEY`, `LOB_LIVE_API_KEY`, `LOB_LIVE_MODE`).
- Preview/commit pattern with a worked Claude Desktop example.
- Idempotency (auto + deterministic-from-token).
- Tool annotations.
- `LOB_MAX_PIECES_PER_RUN`.
- Narrow elicitation env vars.
- "If you only do one thing": run `npx lob-mcp init`.

Add a "Migration from 0.x" section: rename of `LOB_API_KEY` → `LOB_TEST_API_KEY`; live behavior now requires three things (`LOB_TEST_API_KEY` + `LOB_LIVE_API_KEY` + `LOB_LIVE_MODE=true`).

### Task 8.2: CHANGELOG

**Files:**
- Create: `CHANGELOG.md`

```markdown
# Changelog

## 1.0.0 — 2026-04-?? (Hardening release)

### Breaking changes
- `LOB_API_KEY` replaced by `LOB_TEST_API_KEY` (required) and `LOB_LIVE_API_KEY` (optional).
  - Legacy `LOB_API_KEY=test_…` continues to work as a soft fallback.
  - Legacy `LOB_API_KEY=live_…` is rejected with a migration error.
- Live mode requires `LOB_LIVE_MODE=true` AND a `LOB_LIVE_API_KEY`.
- `lob_*_create` (`postcards`, `letters`, `self_mailers`, `checks`, `buckslip_orders`, `card_orders`) requires a `confirmation_token` from the matching `lob_*_preview` tool when in live mode. Set `LOB_REQUIRE_CONFIRMATION=false` to opt out.

### Added
- `lob_*_preview` tools for postcards, letters, self-mailers, checks, buckslip_orders, card_orders.
  - Postcards / letters / self-mailers: real Lob proof PDFs via `/resource_proofs`.
  - Checks / inventory orders: textual preview (Lob has no proof endpoint for these).
- Pluggable `TokenStore` (`InMemoryTokenStore` ships).
- `LOB_MAX_PIECES_PER_RUN` exact-piece cap.
- Narrow elicitation:
  - `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD` — pops a confirm form when check `amount` exceeds threshold.
  - `LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES` — same for inventory orders.
- Mandatory idempotency: auto-generated when not provided; deterministic from confirmation token when present.
- Complete tool annotation matrix on every tool.
- `lob-mcp init` interactive setup wizard.
- Unit test suite via `node:test` + `tsx` (`npm test`).

### Migration from 0.x
1. Rename `LOB_API_KEY` to `LOB_TEST_API_KEY` if it begins with `test_`. Re-supply as `LOB_LIVE_API_KEY` if it begins with `live_`.
2. To send live mail, also set `LOB_LIVE_MODE=true`.
3. To preserve old behavior (no token gate in live mode), set `LOB_REQUIRE_CONFIRMATION=false`.
4. (Recommended) Run `npx lob-mcp init` for a generated config snippet.

## 0.1.4 and earlier
See git history.
```

### Task 8.3: Version bump

**Files:**
- Modify: `package.json` → `"version": "1.0.0"`
- Modify: `src/version.ts` → `"1.0.0"`

### Task 8.4: Final verification (this is where a live key may be useful)

- [ ] **Step 1: Clean build + tests + smoke**

```bash
npm run typecheck
npm run build
npm test
# tools/list smoke — expect 76
```

- [ ] **Step 2: Inspector run-through (test key only)**

Walk through every preview/commit pair in Inspector with a `test_…` key. Confirm:
- Each `*_preview` returns a token (and a real Lob `url` for postcard/letter/self-mailer; textual for checks/orders).
- Each `*_create` succeeds with a matching token in test mode.
- Mutated payload fails with PAYLOAD_MISMATCH.
- Reused token fails with TOKEN_NOT_FOUND.
- `LOB_MAX_PIECES_PER_RUN=2` enforces the cap.
- `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD=10` triggers the form on a $50 check.

- [ ] **Step 3: ASK USER before live test**

Flag to user: "Ready for live verification. Recommended: send one $0.71 4x6 postcard to a maintainer address with `LOB_LIVE_API_KEY` and `LOB_LIVE_MODE=true`. Confirm before proceeding."

If approved:
- Set `LOB_TEST_API_KEY=test_…`, `LOB_LIVE_API_KEY=live_…`, `LOB_LIVE_MODE=true`.
- Inspector: `lob_postcards_preview` → confirm proof URL renders.
- `lob_postcards_create` with the token → confirm Lob returns a `psc_…` ID and a live `url`.
- Re-run the same `*_create` with the same token → confirm `LOB_TOKEN_NOT_FOUND` (already consumed).
- Spot-check the Lob dashboard for the resulting postcard.

### Task 8.5: Final commit + publish

- [ ] **Step 1: Stage everything**

```bash
git add -A
git status
```

- [ ] **Step 2: One commit**

```bash
git commit -m "$(cat <<'EOF'
feat!: 1.0 hardening release — preview/commit, dual-key, idempotency, caps, wizard

- Dual-key config (LOB_TEST_API_KEY required, LOB_LIVE_API_KEY optional, LOB_LIVE_MODE gates).
- Preview/commit split with payload-hash binding for all 6 billable tools.
  - Postcards/letters/self-mailers: real Lob proof PDFs via /resource_proofs.
  - Checks/inventory orders: textual preview (no Lob proof endpoint).
- Mandatory idempotency keys; deterministic from confirmation token.
- Complete tool annotation matrix on every tool.
- Exact piece-count cap (LOB_MAX_PIECES_PER_RUN); no estimated dollar caps.
- Narrow elicitation: check amount + bulk piece thresholds, off by default.
- node:test suite via tsx; lob-mcp init setup wizard.

BREAKING: LOB_API_KEY replaced by LOB_TEST_API_KEY + LOB_LIVE_API_KEY.
BREAKING: Live commits require confirmation_token by default.
See CHANGELOG.md for migration steps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Publish**

```bash
npm publish --dry-run     # verify file list
npm publish               # publish to npm (no --access — package is unscoped)
git tag v1.0.0
git push --tags
```

- [ ] **Step 5: Create GitHub release**

```bash
gh release create v1.0.0 --title "v1.0.0 — Hardening release" --notes-file CHANGELOG.md
```

---

## Definition of Done

- One commit lands at HEAD with all changes.
- `npm run typecheck && npm run build && npm test` clean.
- Smoke test reports 76 tools.
- Inspector verification passes for every preview/commit pair (test key).
- Optional final live check passes (one real postcard).
- Published to npm as `lob-mcp@1.0.0`.
- Pushed to `optimize-overseas/lob-mcp` with `v1.0.0` tag.
- README + CHANGELOG cover all new env vars and the migration.
- `lob-mcp init` wizard works end-to-end.
- Boot banner clearly states the safety posture under each env combination.
