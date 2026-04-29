# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`lob-mcp` is an MCP (Model Context Protocol) server that wraps the [Lob.com](https://lob.com) API, exposing **76 tools across 11 resource groups** — address verification, address book CRUD, mail-piece preview/create/lifecycle (postcards, letters, self-mailers, checks), templates + template versions, campaigns + creatives, buckslips/cards + print orders, QR-code analytics, resource proofs, bank accounts, and webhook subscriptions.

Distributed on npm as [`lob-mcp`](https://www.npmjs.com/package/lob-mcp); runs as a local stdio server via `npx lob-mcp`. The package and repo are public.

## Public-repository discipline

This repository and the npm package are public. When editing or opening PRs:

- No business names, customer data, deployment-specific references, or internal tooling names in code, docs, examples, tests, tool descriptions, or error messages. Keep everything use-case-agnostic.
- Generic placeholders only in examples ("Acme Co", "123 Example St").
- No secrets — API keys, credentials, internal URLs, or live Lob test data must never land in git.

## Commands

```bash
npm install                      # install deps
npm run typecheck                # tsc --noEmit (must stay clean)
npm run build                    # tsc + chmod on the stdio entry
npm test                         # node:test unit suite (47+ tests)
npm run inspector                # MCP Inspector for interactive smoke testing
npm start                        # run the server directly (needs LOB_TEST_API_KEY)
node tests/integration.mjs       # live integration smoke against Lob's test API

# stdio smoke test — init + tools/list (must return 76)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | LOB_TEST_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log("tools:",JSON.parse(d).result.tools.length))'

npm publish                      # publish to npm (unscoped — no --access flag needed)
```

Verification is: clean typecheck + clean build + `npm test` clean + smoke test reports 76 tools + Inspector or `tests/integration.mjs` sanity check on the affected tool group.

## Architecture

Stdio MCP server. The 1.0 hardening release added preview/commit binding, a piece-count cap, and dual-key configuration. Every billable tool comes in `_preview` + `_create` pairs. Every billable POST carries an Idempotency-Key.

```
src/
├── index.ts                     # stdio entry: dual-key boot banner, plumbs LobClient + TokenStore + PieceCounter, dispatches `lob-mcp init`
├── env.ts                       # LobEnv + loadEnv() — dual keys, LOB_LIVE_MODE, safety knobs, soft-fallback for legacy LOB_API_KEY=test_…
├── version.ts                   # SERVER_VERSION + USER_AGENT (single source of truth)
├── init/
│   └── wizard.ts                # `lob-mcp init` interactive setup wizard
├── lob/
│   ├── client.ts                # LobClient.request() — dual auth headers + keyMode routing + idempotency assertion on billable POSTs
│   ├── errors.ts                # LobApiError + LobMcpError taxonomy + formatErrorForTool() chokepoint
│   └── redact.ts                # recursive PII redaction
├── preview/
│   ├── token-store.ts           # TokenStore interface + InMemoryTokenStore (atomic consume)
│   ├── payload-hash.ts          # canonical JSON + SHA-256 (ignores idempotency_key, metadata, confirmation_token)
│   ├── preview-record.ts        # PreviewRecord type
│   └── preview-commit.ts        # buildPreviewCommit() — drives every billable tool
├── safety/
│   ├── piece-counter.ts         # exact LOB_MAX_PIECES_PER_RUN cap
│   └── elicit.ts                # narrow elicitOrFail (fail-closed when client doesn't support)
├── schemas/
│   ├── common.ts                # idempotencyKeySchema/AutoSchema, address, list, metadata, extra schemas
│   └── mail.ts                  # mail-piece-shared schemas
└── tools/
    ├── helpers.ts               # registerTool() + ToolAnnotationPresets (read/preview/commit/destructive/mutate)
    ├── register.ts              # wires every group; threads tokenStore + pieceCounter into billable groups
    └── <group>.ts               # one file per resource group
```

### Patterns that matter when editing

- **Every billable tool uses `buildPreviewCommit()`.** Adding a new billable resource means defining the create shape, the `renderPreview` closure (route through `/resource_proofs` if Lob supports it for that resource_type, else return a textual summary), and the `callCommit` closure (the actual Lob POST). The helper handles token issue, payload-hash binding, idempotency-key derivation, piece-counter reservation, and elicitation routing.
- **Annotations come from `ToolAnnotationPresets`** in `tools/helpers.ts`. Use `read`, `preview`, `commit`, `destructive`, or `mutate` — don't write `readOnlyHint`/`destructiveHint` by hand. Keeps the matrix consistent.
- **Idempotency assertion in `LobClient.request()`** trips on every POST to a billable path that lacks an `Idempotency-Key`. If you ever see this fire, the bug is in the caller — fix the caller, don't relax the assertion.
- **Previews always pass `keyMode: "test"`** to LobClient. Commits inherit `env.effectiveMode` (live when `LOB_LIVE_MODE=true` AND a live key is configured; else test).
- **Token store cleanup is on a 60s interval, `unref()`'d** so it doesn't pin the process. Tests don't wait on it; they call `cleanup()` directly.
- **Every tool uses `registerTool()`** which catches all handler errors via `formatErrorForTool` and returns `{isError:true, content:[…]}` — errors never escape to the JSON-RPC transport.
- **Every create/update tool has an `extra` escape hatch** (`extraParamsSchema`) that lets callers pass any Lob parameter not enumerated in the zod schema.
- **stderr-only logging.** `stdout` is the JSON-RPC transport.
- **PII redaction is recursive.** `redactPii()` walks objects and scrubs `to`, `from`, `name`, `email`, `address_*`, `primary_line`, etc. before any error output crosses the MCP transport.

## Lob endpoint quirks worth remembering

- **Creatives require `tmpl_…` IDs**, not URLs or HTML. Lob's `/v1/creatives` endpoint silently 500s on URL/HTML inputs.
- **`/resource_proofs` requires PDF assets** for content fields, not inline HTML strings (postcards/letters/self-mailers via `*_create` accept HTML, but `/resource_proofs` does not). The `*_preview` tools route through `/resource_proofs`, so HTML inputs to a preview will fail at Lob with a 422.
- **`/resource_proofs` enforces deliverability strictness** on both `to` and `from` addresses, just like `/postcards`. The "deliverable" magic value may not bypass strictness on every account — use a real, verifiable address for testing.
- **Lob has no proof endpoint for checks or inventory orders.** `lob_checks_preview`, `lob_buckslip_orders_preview`, and `lob_card_orders_preview` return textual summaries instead. Token-binding still applies.
- **Buckslips require multipart/form-data.** Lob's spec claims JSON support but the endpoint always returns "front is required" on a JSON body.
- **Buckslip orders use `quantity_ordered`**, card orders use `quantity`. Lob's API is inconsistent across siblings.
- **`lob_resource_proofs_update`** PATCH body accepts only `template_id` — no `status`, `description`, etc.
- **Webhook IDs use the `ep_` prefix** (Lob renamed from `whk_`). The schema accepts both.
- **Webhook update is POST**, not PATCH; `disabled` is read-only (Lob auto-disables on delivery failure).
- **Templates update is POST**, not PATCH.
- **Postcard creative PDFs**: 6.25″×4.25″ for `4x6` size. Buckslips: 8.75″×3.75″. Cards: 3.375″×2.125″.
- **Lob's idempotency TTL is 24 hours.** Retries within that window de-dupe; after that, the same key creates a new resource.

## Lob-specific guardrails

- **Mail-piece create tools cost money and produce physical mail.** Use the preview/commit pattern always; never bypass `LOB_REQUIRE_CONFIRMATION=true` in production.
- **Idempotency on every billable POST** — non-negotiable. The runtime assertion in `LobClient` enforces it.
- **PII never goes into logs.** The client never logs request bodies. Errors pass through `formatErrorForTool` which excludes the body.
- **Lob API version** can be pinned via `LOB_API_VERSION` env var.

## Key external references

- Lob API docs: https://docs.lob.com/
- Lob OpenAPI spec: https://github.com/lob/lob-openapi
- MCP spec: https://modelcontextprotocol.io/
