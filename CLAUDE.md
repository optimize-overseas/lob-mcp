# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`lob-mcp` is an MCP (Model Context Protocol) server that wraps the [Lob.com](https://lob.com) API, exposing **78 tools + 23 design-spec resources across 12 resource groups** — address verification, address book CRUD, mail-piece preview/create/lifecycle (postcards, letters, self-mailers, checks), templates + template versions + template search, campaigns + creatives, buckslips/cards + print orders, QR-code analytics, resource proofs, bank accounts, webhook subscriptions, and design specifications.

Distributed on npm as [`lob-mcp`](https://www.npmjs.com/package/lob-mcp); runs as a local stdio server via `npx lob-mcp`. The package and repo are public.

## Public-repository discipline

**This rule is permanent and non-negotiable.** This repository, the npm package, the GitHub release page, and the git history are all public. The codebase must be completely generic and applicable to any Lob user — exposing nothing about who maintains or uses it, what use cases it gets pointed at, or what specific Lob resources live in any private account.

**Scope — applies to every public surface, not just code:**

- Source files (`src/`), build output (`build/`), schemas, tool descriptions, error messages, log lines, banner text.
- Docs: `README.md`, `CHANGELOG.md`, `CLAUDE.md`, anything under `docs/`.
- Tests that ship in the repo (currently `tests/` is gitignored, but if any test ever becomes tracked it falls under this rule).
- Examples in any of the above.
- Git metadata: **commit messages, tag messages, GitHub release notes, PR descriptions, issue titles/bodies**. These are public artifacts of the repo.
- npm metadata: `package.json` `description` / `keywords` / `author`, the published tarball.

**Forbidden content:**

- Business or customer names (real or thinly anonymized).
- Specific use-case framing (industries, workflows, campaigns, vertical references).
- Real Lob resource identifiers from any private account: `tmpl_…`, `adr_…`, `bnk_…`, `cmp_…`, `crv_…`, `psc_…`, `ltr_…`, `chk_…`, `bck_…`, `crd_…`, `vrf_…`, `ep_…`, `whk_…`, etc. **Even in a "the live verification used X" sentence in a commit message.** Use generic placeholders instead.
- Real template descriptions / campaign names / metadata values from any private account, even if they sound innocuous.
- Account-specific quantities, prices, or volumes that imply who the account belongs to.
- Personal identifiers: maintainer email beyond the `package.json` author block, anyone's name, addresses other than Lob's HQ at 210 King St used as an explicit placeholder.
- Secrets: any API key, credential, internal URL, or live Lob test data.

**Generic placeholders to use instead:** "Welcome Letter" / "Marketing Postcard" for template names, "Acme Co" / "Example LLC" for senders, "123 Example St" / Lob's published HQ for addresses, `tmpl_xxxxxxxxxxxxxxx` for IDs.

**Pre-push / pre-publish audit (run before every commit you intend to push and every release):**

```bash
# Substitute the words/IDs you've recently typed or pasted into work-in-progress
# files, commit messages, or release notes:
git grep -niE 'PATTERN1|PATTERN2|tmpl_[a-f0-9]{15,}'
git log -1 --format=%B | grep -iE 'PATTERN1|PATTERN2|tmpl_[a-f0-9]{15,}'
gh release view vX.Y.Z --json body -q .body | grep -iE 'PATTERN1|PATTERN2'
```

If the audit finds anything, fix it BEFORE pushing. If it lands on `main`, the only correct response is to scrub it (rewriting commit message via `git commit --amend` + force-push to `main` with explicit user approval; editing release notes via `gh release edit`).

**When generating any of: commit messages, tag messages, GitHub release notes** — describe the change in terms a stranger could understand without any reference to the verifying account. *"Live verification confirmed the new behavior on a busy account"* is fine; *"live verification found `<real-template-name>` at `tmpl_<real-id>`"* is not. Even forbidden examples in this very file should be hypothetical (`<placeholder>`), not the actual identifier you saw.

## Commands

```bash
npm install                              # install deps
npm run typecheck                        # tsc --noEmit (must stay clean)
npm run build                            # tsc + chmod entry + copy specs/pdfs/ → build/specs/pdfs/
npm test                                 # node:test unit suite (~183 tests across 20 suites)
npm run inspector                        # MCP Inspector for interactive smoke testing
npm start                                # run the server directly (needs LOB_TEST_API_KEY)
node tests/integration.mjs               # live integration smoke against Lob's test API (22 checks)
node scripts/download-spec-pdfs.mjs      # one-shot refresh: pull Lob's template PDFs into specs/pdfs/

# Run a single test suite
node --test --import tsx tests/unit/specs-manifest.test.ts

# stdio smoke — initialize + tools/list (must return 78)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | LOB_TEST_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log("tools:",JSON.parse(d).result.tools.length))'

# stdio smoke — resources/list (must return 23 entries)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"resources/list"}' \
  | LOB_TEST_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log("resources:",JSON.parse(d).result.resources.length))'

npm publish                              # publish to npm (unscoped — no --access flag needed)
```

Verification before merge: clean typecheck + clean build + `npm test` clean + smoke reports 78 tools + 23 resources + `tests/integration.mjs` passes 22/22 + Inspector sanity check on the affected tool group.

## Architecture

Stdio MCP server with three layered subsystems:

1. **Safety harness (1.0)** — preview/commit token binding, dual-key auth, idempotency assertion, piece-count cap, narrow elicitation. Every billable tool comes in `_preview` + `_create` pairs.
2. **Design specs (1.1)** — Lob's official mail-piece dimensions, no-print zones, and PDF templates exposed as MCP resources + a fallback tool. Threaded inline into every `*_preview` response so the model has authoritative no-print-zone coordinates when reviewing a Lob proof.
3. **Tool layer** — one file per Lob resource group, all funneling through a single thin HTTP client.

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
├── specs/
│   ├── manifest.ts              # SOURCE OF TRUTH: typed DesignSpec records for every (mail_type, variant)
│   ├── pdf-loader.ts            # reads bundled PDFs from build/specs/pdfs/, caches in-process
│   └── register.ts              # registers JSON resource template + 11 static PDF resources + lob_design_specs_get tool
├── schemas/
│   ├── common.ts                # idempotencyKeySchema/AutoSchema, address, list, metadata, extra schemas
│   └── mail.ts                  # mail-piece-shared schemas
└── tools/
    ├── helpers.ts               # registerTool() + ToolAnnotationPresets (read/preview/commit/destructive/mutate)
    ├── register.ts              # wires every group; threads tokenStore + pieceCounter into billable groups; calls registerSpecsResources(server)
    └── <group>.ts               # one file per resource group
specs/pdfs/                      # bundled Lob template PDFs (committed to git, not under src/)
build/specs/pdfs/                # populated by `npm run build`; ships in npm tarball
scripts/
├── download-spec-pdfs.mjs       # one-shot fetch from Lob's S3 — maintainer refresh helper
└── copy-spec-pdfs.mjs           # build step: specs/pdfs/ → build/specs/pdfs/
```

### Patterns that matter when editing

- **Every billable tool uses `buildPreviewCommit()`** (`src/preview/preview-commit.ts`). Adding a new billable resource means defining the create shape, the `renderPreview` closure (route through `/resource_proofs` if Lob supports it for that resource_type, else return a textual summary), and the `callCommit` closure (the actual Lob POST). The helper handles token issue, payload-hash binding, idempotency-key derivation, piece-counter reservation, and elicitation routing.
- **Every preview's `renderPreview` closure attaches `design_spec` inline** by calling `findSpec(mail_type, variant)` from `src/specs/manifest.ts`. New variants must be added to the manifest first — otherwise `findSpec` returns null and the preview surfaces `design_spec: null`. The integration smoke fails on missing entries.
- **Adding a new (mail_type, variant) spec** = (1) add a `DesignSpec` entry to `SPEC_MANIFEST` in `src/specs/manifest.ts`, (2) drop the matching PDF in `specs/pdfs/{mail_type}-{variant}.pdf` (use `pdfFilenameFor` helper to compute the filename — dots in the variant become underscores), (3) `npm run build` to copy into `build/specs/pdfs/`, (4) integration smoke covers the rest automatically.
- **Annotations come from `ToolAnnotationPresets`** in `tools/helpers.ts`. Use `read`, `preview`, `commit`, `destructive`, or `mutate` — don't write `readOnlyHint`/`destructiveHint` by hand. Keeps the matrix consistent.
- **Idempotency assertion in `LobClient.request()`** trips on every POST to a billable path that lacks an `Idempotency-Key`. If you ever see this fire, the bug is in the caller — fix the caller, don't relax the assertion.
- **Previews always pass `keyMode: "test"`** to LobClient. Commits inherit `env.effectiveMode` (live when `LOB_LIVE_MODE=true` AND a live key is configured; else test).
- **MCP resource URIs use slashes; on-disk filenames use hyphens.** `lob://specs/letter/legal_8.5x14.pdf` ↔ `build/specs/pdfs/letter-legal_8_5x14.pdf` (slash → hyphen, dot → underscore). The conversion lives in `pdfFilenameFor()` in `src/specs/pdf-loader.ts`.
- **Token store cleanup is on a 60s interval, `unref()`'d** so it doesn't pin the process. Tests don't wait on it; they call `cleanup()` directly.
- **Every tool uses `registerTool()`** which catches all handler errors via `formatErrorForTool` and returns `{isError:true, content:[…]}` — errors never escape to the JSON-RPC transport.
- **Every create/update tool has an `extra` escape hatch** (`extraParamsSchema`) that lets callers pass any Lob parameter not enumerated in the zod schema.
- **stderr-only logging.** `stdout` is the JSON-RPC transport — `console.log` will corrupt the protocol. All banners and errors go through `console.error`.
- **PII redaction is recursive.** `redactPii()` walks objects and scrubs `to`, `from`, `name`, `email`, `address_*`, `primary_line`, etc. before any error output crosses the MCP transport.
- **Every Lob fetch has a per-request timeout** (`LobClient.request` wires an `AbortController` + `setTimeout`, default `LOB_REQUEST_TIMEOUT_MS=30000`). A timeout surfaces as `LobTimeoutError`, formatted with the path and configured ms so the consumer can raise the budget. Each request gets its own controller — never share signals across calls.
- **`lob_templates_list` and `lob_template_versions_list` are slim by default.** They strip `published_version.html` and drop `versions[]` (replaced with `version_count`). Lob template HTML can be megabytes; on busy accounts the list response can hit 70+ MB raw. Use `include_html: true` for the full body, or `lob_templates_get(id)` for a single record. The list-size guard in `tools/templates.ts` (`MAX_LIST_RESPONSE_BYTES = 1.5 MB`) is a last-line defense — if you see it fire, slim further or narrow with `lob_templates_search`.
- **`lob_templates_search`** walks `/templates` server-side with optional metadata filter, then matches `description_contains` client-side (case-insensitive). Returns slim records. Default caps: `limit=20`, `max_pages=5` (page size 100 → up to 500 templates inspected). Use this whenever the LLM has a template name but not a `tmpl_…` id.
- **Tests live at `tests/unit/*.test.ts`** — `node:test` + `tsx`, no jest/vitest. The `tests/` tree is gitignored (so new test files won't appear in `git status` and aren't shipped in the npm tarball; that's the project's chosen pattern). HTTP-touching tests stub `globalThis.fetch` and restore in `afterEach` — see `tests/unit/idempotency.test.ts` and `tests/unit/timeout.test.ts` for the canonical shape (capture/replace pattern, AbortSignal-honoring delay stubs). Tool wire-up tests build a fake `McpServer` with a `registerTool: (name, _config, handler) => tools.set(name, handler)` shim and invoke the captured handler directly — see `tests/unit/templates-tools.test.ts`.

## Lob endpoint quirks worth remembering

- **Creatives require `tmpl_…` IDs**, not URLs or HTML. Lob's `/v1/creatives` endpoint silently 500s on URL/HTML inputs.
- **`/resource_proofs` requires PDF assets** for content fields, not inline HTML strings (postcards/letters/self-mailers via `*_create` accept HTML, but `/resource_proofs` does not). The `*_preview` tools route through `/resource_proofs`, so HTML inputs to a preview will fail at Lob with a 422.
- **`/resource_proofs` enforces deliverability strictness** on both `to` and `from` addresses, just like `/postcards`. The "deliverable" magic value may not bypass strictness on every account — use a real, verifiable address for testing (e.g. Lob's HQ at `210 King St, San Francisco, CA 94107`).
- **Lob has no proof endpoint for checks or inventory orders.** `lob_checks_preview`, `lob_buckslip_orders_preview`, and `lob_card_orders_preview` return textual summaries instead. Token-binding still applies.
- **Buckslips require multipart/form-data.** Lob's spec claims JSON support but the endpoint always returns "front is required" on a JSON body.
- **Buckslip orders use `quantity_ordered`**, card orders use `quantity`. Lob's API is inconsistent across siblings.
- **`lob_resource_proofs_update`** PATCH body accepts only `template_id` — no `status`, `description`, etc.
- **Webhook IDs use the `ep_` prefix** (Lob renamed from `whk_`). The schema accepts both.
- **Webhook update is POST**, not PATCH; `disabled` is read-only (Lob auto-disables on delivery failure).
- **Templates update is POST**, not PATCH.
- **Postcard creative PDFs**: 6.25″×4.25″ for `4x6` size. Buckslips: 8.75″×3.75″. Cards: 3.375″×2.125″.
- **Lob's idempotency TTL is 24 hours.** Retries within that window de-dupe; after that, the same key creates a new resource.
- **Postcard back ink-free zones differ by size.** 4×6 → 3.2835″×2.375″. 6×9 and 6×11 → 4.0″×2.375″. All anchored bottom-right with 0.275″ horizontal and 0.25″ vertical offset. The `SPEC_MANIFEST` is authoritative.

## Lob-specific guardrails

- **Mail-piece create tools cost money and produce physical mail.** Use the preview/commit pattern always; never bypass `LOB_REQUIRE_CONFIRMATION=true` in production.
- **Idempotency on every billable POST** — non-negotiable. The runtime assertion in `LobClient` enforces it.
- **PII never goes into logs.** The client never logs request bodies. Errors pass through `formatErrorForTool` which excludes the body.
- **Lob API version** can be pinned via `LOB_API_VERSION` env var.

## Key external references

- Lob API docs: https://docs.lob.com/
- Lob design templates: https://help.lob.com/print-and-mail/designing-mail-creatives/
- Lob OpenAPI spec: https://github.com/lob/lob-openapi
- MCP spec: https://modelcontextprotocol.io/
