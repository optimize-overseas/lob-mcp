# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`lob-mcp` is an MCP (Model Context Protocol) server that wraps the [Lob.com](https://lob.com) API, exposing **70 tools across 10 resource groups** — address verification, address book CRUD, mail-piece creation and lifecycle (postcards, letters, self-mailers, checks), templates + template versions, campaigns + creatives, buckslips/cards + print orders, QR-code analytics, resource proofs, bank accounts, and webhook subscriptions.

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
npm run inspector                # MCP Inspector for interactive smoke testing
npm start                        # run the server directly (needs LOB_API_KEY)

# stdio smoke test — init + tools/list (must return 70)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | LOB_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log("tools:",JSON.parse(d).result.tools.length))'

npm publish                      # publish to npm (unscoped — no --access flag needed)
```

No formal test suite. Verification is: clean typecheck + clean build + smoke test reports 70 tools + Inspector sanity check on the affected tool group. For deeper verification, the package has been exercised end-to-end against Lob's live API (both test and live keys) — every tool has returned a 2xx success at least once. The verification harness lives outside the published artifact.

## Architecture

Stdio MCP server; every tool funnels through a single thin HTTP client that speaks to Lob's REST API directly (no dependency on `@lob/lob-typescript-sdk` — we want tight control over headers, query encoding, multipart encoding, and redaction).

```
src/
├── index.ts                     # stdio entry: boots McpServer + LobClient, logs test/live mode banner to stderr
├── env.ts                       # LobEnv + loadEnv() — infers mode from API-key prefix (test_ / live_)
├── version.ts                   # single source of truth for SERVER_VERSION + USER_AGENT
├── lob/
│   ├── client.ts                # LobClient.request() — HTTP Basic auth, Idempotency-Key, Lob-Version, nested-bracket query encoding, asForm multipart
│   ├── errors.ts                # LobApiError + formatErrorForTool() — single chokepoint for error surfacing
│   └── redact.ts                # PII redaction — recurses into payloads, scrubs address/contact keys before they cross the MCP transport
├── schemas/
│   ├── common.ts                # shared zod schemas: inlineAddressSchema, addressRefSchema, idempotencyKeySchema, listParamsSchema, extraParamsSchema, dateFilterSchema, metadataSchema + compact() + withExtra()
│   └── mail.ts                  # mail-piece-shared schemas: mailPieceCommonShape, contentSourceSchema, color/doubleSided/addressPlacement
└── tools/
    ├── helpers.ts               # registerTool() — wraps handlers with consistent JSON formatting and error → isError:true mapping
    ├── register.ts              # single wire-up function that registers all 11 group files
    └── <group>.ts               # one file per resource group (address-book, verifications, postcards, letters, self-mailers, checks, templates, campaigns, uploads, bank-accounts, webhooks)
```

### Patterns that matter when editing

- **Every tool uses `registerTool()`** from `tools/helpers.ts`. It catches all handler errors via `formatErrorForTool` and returns `{isError:true, content:[…]}` — errors never escape to the JSON-RPC transport.
- **Every create/update tool has an `extra` escape hatch** (`extraParamsSchema`) that lets callers pass any Lob parameter not enumerated in the zod schema. Merged via `withExtra(payload, extra)` with typed fields taking precedence.
- **Every billable create tool accepts `idempotency_key`** which becomes the `Idempotency-Key` header on the POST. Covers mail-piece creates and `*_orders_create` (buckslip/card print orders).
- **Tool annotations drive host confirmation prompts.** Read-only tools set `readOnlyHint:true + idempotentHint:true`; cancel/delete tools set `destructiveHint:true`; billable creates get `(BILLABLE)` in the title. Hosts render these differently — keep them accurate.
- **stderr-only logging.** `stdout` is the JSON-RPC transport — `console.log` will corrupt the protocol. All banners and errors go through `console.error`.
- **PII redaction is recursive.** `redactPii()` in `lob/redact.ts` walks objects and scrubs any key in `ADDRESS_KEYS` (`to`, `from`, `name`, `email`, `address_*`, `primary_line`, etc.). Anything echoed back through error output passes through `safeStringify` first.

## Lob endpoint quirks worth remembering

These are non-obvious bits surfaced by full live-API verification — read once, save future debugging.

- **Creatives require `tmpl_…` IDs**, not URLs or HTML. Lob's `/v1/creatives` endpoint silently 500s on URL/HTML inputs that postcards/letters happily accept. Schema enforces this via `z.string().regex(/^tmpl_/)` on `front`/`back`/`inside`/`outside`/`file`. To use a URL or HTML, callers should call `lob_templates_create` first and pass the resulting `tmpl_…` here.
- **Buckslips require multipart/form-data.** Lob's spec claims JSON support but the endpoint always returns "front is required" on a JSON body. The tool sets `asForm: true` to send multipart; this works correctly.
- **Buckslip orders use `quantity_ordered`**, card orders use `quantity`. Lob's API is inconsistent across siblings; the schemas reflect each endpoint's actual field name.
- **`lob_resource_proofs_create`** body shape is `{resource_type, resource_parameters}`, where `resource_parameters` carries the same fields as the underlying create call (e.g. `{front, back, to}` for a postcard).
- **`lob_resource_proofs_update`** PATCH body accepts only `template_id` — no `status`, `description`, etc.
- **Webhook IDs use the `ep_` prefix** (Lob renamed from `whk_`). The schema accepts both for backward compatibility.
- **Webhook update is POST**, not PATCH; `disabled` is read-only (Lob auto-disables on delivery failure).
- **Templates update is POST**, not PATCH.
- **Postcard creative PDFs**: 6.25″×4.25″ for `4x6` size. Buckslips: 8.75″×3.75″. Cards: 3.375″×2.125″. PDFs at any other dimensions are rejected with a clean 422.

## Lob-specific guardrails

- **Mail-piece create tools cost money and produce physical mail.** Keep `readOnlyHint:false`, keep the `(BILLABLE)` title marker, and document the side effect in the description. Develop with a `test_…` key (mode detection is automatic from key prefix).
- **Idempotency on every billable create** — non-negotiable. Retries without a stable key duplicate real mail.
- **PII never goes into logs.** The client never logs request bodies. Errors pass through `formatErrorForTool` which deliberately excludes the body. If you add new logging, route it through `safeStringify`.
- **Lob API version** can be pinned via `LOB_API_VERSION` env var (forwarded as `Lob-Version` header); omit to use the account default.

## Key external references

- Lob API docs: https://docs.lob.com/
- Lob OpenAPI spec: https://github.com/lob/lob-openapi
- MCP spec: https://modelcontextprotocol.io/
