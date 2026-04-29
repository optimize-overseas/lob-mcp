# lob-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server for the [Lob.com](https://lob.com) API. Lets any MCP-compatible LLM (Claude, ChatGPT, etc.) verify addresses and send physical mail — postcards, letters, self-mailers, and printed checks — through Lob.

> ⚠️ **Lob produces real physical mail and charges your account.** lob-mcp ships a layered safety harness: dual-key configuration (test required, live optional), preview/commit gating with payload binding, mandatory idempotency, an exact piece-count cap, optional narrow elicitation for high-value sends, and bundled Lob design-spec resources so AI design tools can produce print-correct artwork that respects auto-stamped address blocks. Default mode is **test**. Live mode requires an explicit opt-in.

## Quick start

```bash
npx lob-mcp init
```

Walks through keys + safety caps, then prints a paste-ready Claude Desktop config snippet and a `claude mcp add` one-liner. No files written automatically.

## Features

- **77 tools + 23 design-spec resources** across 12 resource groups — address verification, address book, postcards, letters, self-mailers, checks, templates, campaigns + creatives, buckslips/cards + print orders, QR-code analytics, resource proofs, bank accounts, webhooks, and design specifications.
- **Preview/commit split** on every billable resource — `lob_<resource>_preview` returns a Lob-rendered proof PDF (postcards/letters/self-mailers) or a textual summary (checks/inventory orders) plus a `confirmation_token`. The matching `lob_<resource>_create` requires that token in live mode and rejects payload mutations.
- **Dual-key model** — `LOB_TEST_API_KEY` (always required) is used for previews. `LOB_LIVE_API_KEY` (optional) is used for commits when `LOB_LIVE_MODE=true`. Previews always render against the test key, so a real Lob proof PDF is returned regardless of whether live mode is enabled.
- **Idempotency by default** on every billable POST — auto-generated when omitted; deterministic from the confirmation token when present, so retries de-dupe at Lob automatically.
- **Exact piece-count cap** via `LOB_MAX_PIECES_PER_RUN`. Hard ceiling, not estimate.
- **Narrow elicitation (off by default)** — opt-in confirmation forms for check `amount` over a USD threshold or bulk inventory orders over a piece threshold.
- **Complete tool annotation matrix** — every tool sets `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` so hosts can render appropriate confirmation prompts.
- **PII redaction** in error output.
- **Generic `extra` parameter** on every create/update tool — any Lob field not enumerated in the schema is merged verbatim.
- **Design-spec resources** — Lob's official template PDFs and structured JSON specs (dimensions, bleed, safe area, no-print zones, file-format requirements) for every supported variant. AI tools can fetch them before generating artwork to avoid the auto-stamped address-block clipping that catches naive designs.
- **Spec-driven schemas** mirroring Lob's published OpenAPI spec, verified against Lob's live API.

## Requirements

- Node.js ≥ 18
- A Lob test API key — get one free at <https://dashboard.lob.com/settings/api-keys>
- (Optional) A Lob live API key, only if you want to send real mail

## Installation

### Run via npx (no install)

```bash
npx lob-mcp           # start the server (reads env from your host config)
npx lob-mcp init      # interactive setup wizard — prints config snippets
```

### Install globally

```bash
npm install -g lob-mcp
lob-mcp
```

### Install from source

```bash
git clone https://github.com/optimize-overseas/lob-mcp.git
cd lob-mcp
npm install
npm run build
node build/index.js
```

## Configuration

The server is configured entirely through environment variables. Run `lob-mcp init` for an interactive walkthrough that emits a paste-ready snippet.

### Keys

| Variable | Required | Description |
|---|---|---|
| `LOB_TEST_API_KEY` | **Yes** | Lob `test_…` key. Used for previews via `/resource_proofs` and for all calls when live mode is not enabled. |
| `LOB_LIVE_API_KEY` | No | Lob `live_…` key. Used for commits when `LOB_LIVE_MODE=true`. Without it, billable commits run in test mode (no real mail). |

> **Migration from 0.x:** `LOB_API_KEY` has been replaced. A `test_…` key in `LOB_API_KEY` is silently accepted as the test key (soft fallback). A `live_…` key in `LOB_API_KEY` is rejected with a migration error — set `LOB_TEST_API_KEY` and `LOB_LIVE_API_KEY` explicitly.

### Mode

| Variable | Default | Description |
|---|---|---|
| `LOB_LIVE_MODE` | `false` | Set to `true` to enable real mail and charges. Requires `LOB_LIVE_API_KEY`. |

### Safety knobs

| Variable | Default | Description |
|---|---|---|
| `LOB_REQUIRE_CONFIRMATION` | `true` | When `true`, live-mode commits require a `confirmation_token` from the matching `*_preview` tool. Set to `false` to skip the gate (loses payload-binding safety). |
| `LOB_CONFIRMATION_TTL_SECONDS` | `600` | How long a preview's `confirmation_token` stays valid. |
| `LOB_MAX_PIECES_PER_RUN` | _(unset)_ | Exact ceiling on the total number of mail pieces this server process may create. Counter resets when the server restarts. |
| `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD` | _(unset)_ | If set, fires an MCP elicitation form when a check `amount` exceeds this threshold. The form must be confirmed before the send. |
| `LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES` | _(unset)_ | If set, fires elicitation when a buckslip or card inventory order's quantity exceeds this threshold. |

### Lob HTTP

| Variable | Default | Description |
|---|---|---|
| `LOB_API_VERSION` | _(account default)_ | Pin a specific Lob API version via the `Lob-Version` header (e.g. `2020-02-11`). |
| `LOB_BASE_URL` | `https://api.lob.com/v1` | Override the Lob API base URL. |

## Use with Claude Desktop

Run `npx lob-mcp init` to generate the JSON snippet. Paste it under `mcpServers` in your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lob": {
      "command": "npx",
      "args": ["-y", "lob-mcp"],
      "env": {
        "LOB_TEST_API_KEY": "test_your_key_here",
        "LOB_LIVE_API_KEY": "live_your_key_here",
        "LOB_LIVE_MODE": "true",
        "LOB_MAX_PIECES_PER_RUN": "10"
      }
    }
  }
}
```

Restart Claude Desktop. The Lob tools should appear in the tool picker.

## Use with Claude Code

```bash
claude mcp add lob \
  --env LOB_TEST_API_KEY=test_your_key_here \
  --env LOB_LIVE_API_KEY=live_your_key_here \
  --env LOB_LIVE_MODE=true \
  --env LOB_MAX_PIECES_PER_RUN=10 \
  -- npx -y lob-mcp
```

## Use with the MCP Inspector

```bash
npm run inspector
```

Then open the URL printed to your terminal. Set `LOB_TEST_API_KEY` (and optionally the live key + `LOB_LIVE_MODE=true`) in the inspector's environment panel before invoking tools.

## Safety model

The 1.0 hardening release implements a layered safety harness:

1. **Default test mode.** Without `LOB_LIVE_MODE=true`, every commit runs against the test key — no real mail, no charges. Read tools work the same in either mode.
2. **Preview/commit split.** Every billable tool has a matching `*_preview` that calls Lob via the test key against `/resource_proofs` (postcards/letters/self-mailers) or returns a textual summary (checks/inventory orders). The preview returns a `confirmation_token`. Calling `*_create` in live mode requires that token AND rejects any payload mutation between preview and commit.
3. **Mandatory idempotency.** No billable POST leaves the server without an `Idempotency-Key`. The server auto-generates a UUID if you don't supply one; when a confirmation token is present, the key is `lob-mcp-${token}` so retrying the same commit de-duplicates at Lob (24-hour window).
4. **Exact piece cap.** `LOB_MAX_PIECES_PER_RUN` is checked at commit time. Exceeding it raises `LOB_PIECE_CAP_EXCEEDED` before any Lob call.
5. **Narrow elicitation.** Two opt-in env vars (`LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD`, `LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES`) fire an MCP elicitation form on high-value sends. Both default off.
6. **Tool annotations.** Every tool sets `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` so hosts render appropriate confirmation prompts.
7. **PII redaction.** Address, name, and contact fields are stripped from any error payload echoed back to the client. The full request body is never logged.

If you only do one thing, run `lob-mcp init` and accept the recommended `LOB_MAX_PIECES_PER_RUN` value.

## Design specifications

lob-mcp exposes Lob's official mail-piece design specifications so AI design tools can produce print-correct artwork. Three access surfaces, all reading from a single source-of-truth manifest:

### MCP resources (recommended)

Hosts that support MCP resources (Claude Desktop, MCP Inspector, Cursor 0.40+, most modern agent frameworks) can browse and attach specs to chat context:

- **JSON spec** — `lob://specs/{mail_type}/{variant}.json` returns structured data: dimensions (in inches), bleed, safe area, no-print zones with anchor + offset semantics, surface descriptions, and file-format requirements.
- **PDF template** — `lob://specs/{mail_type}/{variant}.pdf` returns Lob's official boundary template as a base64 blob, bundled with the npm package (no external fetch).

`resources/list` returns 23 entries (12 JSON + 11 PDF — `card` has a JSON spec but no Lob-published PDF). Each is annotated with `audience: ["user", "assistant"]` so hosts surface them in resource pickers.

### Inline in preview responses

Every `lob_*_preview` tool response includes a `design_spec` field with the spec for the variant being previewed. The model has the no-print-zone coordinates in scope when reviewing a Lob proof, so it can self-audit before committing.

### Fallback tool

For hosts without resource support, call `lob_design_specs_get(mail_type, variant)` — same JSON, returned inline.

### Supported variants

| `mail_type` | `variant` | PDF? |
|---|---|---|
| `postcard` | `4x6`, `6x9`, `6x11` | ✓ |
| `letter` | `standard_no10`, `flat_9x12`, `legal_8.5x14`, `custom_envelope` | ✓ |
| `self_mailer` | `6x18_bifold`, `11x9_bifold` | ✓ |
| `check` | `standard` | ✓ |
| `buckslip` | `standard` | ✓ |
| `card` | `standard` | (Lob does not publish a standalone PDF) |

### Why this matters

Lob auto-stamps the recipient address, IMb barcode, and postage indicia onto specific zones of every billable mail piece. A 4×6 postcard, for example, has a 3.2835″×2.375″ ink-free zone in the lower-right of the back side — any text or critical artwork placed there will be clipped at print. The spec resources document this zone (and every other surface constraint) in machine-readable form so an LLM can lay out artwork that respects it.

### Refreshing PDF templates

Maintainers can pull the latest PDFs from Lob's S3 with:

```bash
node scripts/download-spec-pdfs.mjs
npm run build
```

Re-commit the refreshed `specs/pdfs/*.pdf` files. The build step copies them into `build/specs/pdfs/` so they ship in the npm tarball.

## Tool reference

All tools are namespaced `lob_<resource>_<action>`. The six billable tools come in `_preview` + `_create` pairs:

| Resource | Preview | Commit (BILLABLE) |
|---|---|---|
| Postcards | `lob_postcards_preview` | `lob_postcards_create` |
| Letters | `lob_letters_preview` | `lob_letters_create` |
| Self-mailers | `lob_self_mailers_preview` | `lob_self_mailers_create` |
| Checks | `lob_checks_preview` | `lob_checks_create` |
| Buckslip orders | `lob_buckslip_orders_preview` | `lob_buckslip_orders_create` |
| Card orders | `lob_card_orders_preview` | `lob_card_orders_create` |

### Address book

- `lob_addresses_create` · `lob_addresses_list` · `lob_addresses_get` · `lob_addresses_delete`

### Address verification

- `lob_us_verifications_create` · `lob_us_verifications_get`
- `lob_us_autocompletions_create`
- `lob_intl_verifications_create`
- `lob_bulk_us_verifications_create` · `lob_bulk_intl_verifications_create`
- `lob_identity_validation`

### Postcards

- `lob_postcards_preview` · `lob_postcards_create` (BILLABLE) · `lob_postcards_list` · `lob_postcards_get` · `lob_postcards_cancel`

### Letters

- `lob_letters_preview` · `lob_letters_create` (BILLABLE) · `lob_letters_list` · `lob_letters_get` · `lob_letters_cancel`

### Self-mailers

- `lob_self_mailers_preview` · `lob_self_mailers_create` (BILLABLE) · `lob_self_mailers_list` · `lob_self_mailers_get` · `lob_self_mailers_cancel`

### Checks

- `lob_checks_preview` · `lob_checks_create` (BILLABLE + DRAWS FUNDS) · `lob_checks_list` · `lob_checks_get` · `lob_checks_cancel`

> **Checks have no Lob proof endpoint.** `lob_checks_preview` returns a textual summary instead of a PDF. The token still binds the payload — committing a different `amount`, `to`, or bank account is rejected with `LOB_TOKEN_PAYLOAD_MISMATCH`.

### Templates and template versions

- `lob_templates_create` · `lob_templates_list` · `lob_templates_get` · `lob_templates_update` · `lob_templates_delete`
- `lob_template_versions_create` · `lob_template_versions_list` · `lob_template_versions_get` · `lob_template_versions_update` · `lob_template_versions_delete`

### Campaigns + creatives (live-mode key required)

- `lob_campaigns_create` · `lob_campaigns_list` · `lob_campaigns_get` · `lob_campaigns_update` · `lob_campaigns_delete`
- `lob_creatives_create` · `lob_creatives_get` · `lob_creatives_update` · `lob_creatives_delete`

> **Creative content quirk.** Lob's `/v1/creatives` endpoint accepts only Lob template IDs (`tmpl_…`) for the `front`, `back`, `inside`, `outside`, and `file` content fields — **not** HTML strings or remote URLs. To use a URL or HTML as creative content, first call `lob_templates_create` to upload it as a template, then pass the resulting `tmpl_…` here.

### Buckslips, cards, and print orders

- `lob_buckslips_create` · `lob_buckslips_list` · `lob_buckslips_get`
- `lob_buckslip_orders_preview` · `lob_buckslip_orders_create` (BILLABLE) · `lob_buckslip_orders_list`
- `lob_cards_create` · `lob_cards_list` · `lob_cards_get`
- `lob_card_orders_preview` · `lob_card_orders_create` (BILLABLE) · `lob_card_orders_list`

> Buckslip and card create endpoints require a publicly-reachable PDF URL with exact dimensions (8.75″×3.75″ for buckslips, 3.375″×2.125″ for cards). Lob's buckslip create accepts only `multipart/form-data` and is sent as such by this server. Inventory orders have no Lob proof endpoint, so the preview is textual.

### QR codes and resource proofs

- `lob_qr_codes_list`
- `lob_resource_proofs_create` · `lob_resource_proofs_get` · `lob_resource_proofs_update`

### Bank accounts (required to draw checks)

- `lob_bank_accounts_create` · `lob_bank_accounts_list` · `lob_bank_accounts_get` · `lob_bank_accounts_delete` · `lob_bank_accounts_verify`

### Webhooks

- `lob_webhooks_create` · `lob_webhooks_list` · `lob_webhooks_get` · `lob_webhooks_update` · `lob_webhooks_delete`

## The `extra` escape hatch

Lob's API has many resource-specific options that aren't worth enumerating in a tool schema. Every create/update tool accepts an optional `extra` object whose keys are merged verbatim into the request body, with explicitly-typed fields taking precedence:

```jsonc
{
  "to": "adr_123…",
  "from": "adr_456…",
  "front": "<html>…</html>",
  "back": "<html>…</html>",
  "extra": {
    "billing_group_id": "bg_…",
    "use_type": "marketing"
  }
}
```

Refer to <https://docs.lob.com/> for the full set of parameters per resource.

## Development

```bash
npm install
npm run typecheck
npm run build
npm test                         # node:test unit suite
npm run inspector                # interactive smoke testing
node tests/integration.mjs       # live integration smoke (needs .env.test)
```

The compiled output lives in `build/`. Source is in `src/`.

## Architecture

```
src/
├── index.ts            # stdio entry — boots McpServer + LobClient + stores
├── env.ts              # dual-key env loading + safety knobs
├── version.ts          # SERVER_VERSION + USER_AGENT
├── init/
│   └── wizard.ts       # `lob-mcp init` interactive setup
├── lob/
│   ├── client.ts       # fetch-based HTTP client (dual auth, idempotency assertion)
│   ├── errors.ts       # LobApiError + LobMcpError + tool-friendly formatter
│   └── redact.ts       # recursive PII redaction
├── preview/
│   ├── token-store.ts  # TokenStore interface + InMemoryTokenStore
│   ├── payload-hash.ts # canonical JSON + SHA-256
│   ├── preview-record.ts
│   └── preview-commit.ts # buildPreviewCommit helper
├── safety/
│   ├── piece-counter.ts # exact piece-count cap
│   └── elicit.ts        # narrow elicitOrFail helper
├── schemas/
│   ├── common.ts       # address, pagination, idempotency, metadata schemas
│   └── mail.ts         # mail-piece-shared schemas
└── tools/
    ├── helpers.ts      # registerTool + ToolAnnotationPresets
    ├── register.ts     # wires every group into the server
    └── *.ts            # one file per resource group
```

The HTTP client is intentionally thin — it does not depend on the official `lob-typescript-sdk`, which keeps the dependency surface small and gives this server tighter control over headers, retries, multipart encoding, and PII handling.

## Limitations

- **Multipart file uploads from disk** are supported by the underlying client (`asForm: true`) but the user-facing tools accept content via URL, HTML string, or Lob template ID — not a local filesystem path.
- **OAuth** is not supported because Lob does not offer it. Auth is HTTP Basic with an API key.
- **Some endpoints require a live-mode key.** The campaigns + creatives API and the verification-retrieval endpoint return 403 in test mode.
- **Token store is in-memory.** A multi-process or restart-resilient deployment would need a Redis or Firestore backend; the `TokenStore` interface is shaped for this.

## Contributing

Issues and pull requests welcome at <https://github.com/optimize-overseas/lob-mcp>.

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

This project is **not** affiliated with, endorsed by, or sponsored by Lob.com. "Lob" is a trademark of Lob.com, Inc. Use of the Lob API is subject to Lob's [Terms of Service](https://www.lob.com/terms-of-service) and [Acceptable Use Policy](https://www.lob.com/acceptable-use-policy).
