# lob-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server for the [Lob.com](https://lob.com) API. Lets any MCP-compatible LLM (Claude, ChatGPT, etc.) verify addresses and send physical mail — postcards, letters, self-mailers, and printed checks — through Lob.

> ⚠️ **Lob produces real physical mail and charges your account.** Mail-piece create tools (`lob_postcards_create`, `lob_letters_create`, `lob_self_mailers_create`, `lob_checks_create`, `lob_buckslip_orders_create`, `lob_card_orders_create`) are billable. Develop with a `test_…` API key. Switch to `live_…` only when you are ready to ship real mail. Always pass an `idempotency_key` so retries don't duplicate sends.

## Features

- **70 tools** across **10 resource groups** covering the Lob v1 API:
  - Address book — CRUD
  - Address verification — US + international (single, bulk, autocomplete), identity validation
  - Mail pieces — postcards, letters, self-mailers, checks (create, list, retrieve, cancel)
  - Templates — CRUD on templates and their versions
  - Campaigns + creatives — CRUD (live-mode key required for the campaigns API)
  - Buckslips and cards — uploads + print orders
  - QR-code analytics — list scan events
  - Resource proofs — preview before send
  - Bank accounts — register, verify (micro-deposit), CRUD
  - Webhook subscriptions — CRUD
- **Idempotency** support on every billable create endpoint — retries are safe by default.
- **Test/live mode auto-detection** from the API key prefix; surfaced at startup so an LLM can adjust behavior accordingly.
- **PII redaction** — recipient name, address, email, and phone fields are scrubbed from any error output before it crosses the MCP transport.
- **Generic `extra` parameter** on every create/update tool — accepts any Lob parameter not enumerated in the schema, so you're never blocked by SDK lag.
- **Spec-driven schemas** — tool input schemas mirror Lob's published OpenAPI spec, including correct field names, content-type quirks, and per-endpoint validation rules. Verified end-to-end against the live Lob API (test + live).

## Requirements

- Node.js ≥ 18
- A Lob API key — get one free at <https://dashboard.lob.com/settings/api-keys>

## Installation

### Run via npx (no install)

```bash
npx lob-mcp
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

The server is configured entirely through environment variables.

| Variable | Required | Description |
|---|---|---|
| `LOB_API_KEY` | **Yes** | Your Lob API key. Use a `test_…` key during development; mail-piece tools will not produce real mail in test mode. |
| `LOB_API_VERSION` | No | Pin a specific Lob API version via the `Lob-Version` header (e.g. `2020-02-11`). Omit to use your account default. |
| `LOB_BASE_URL` | No | Override the Lob API base URL. Defaults to `https://api.lob.com/v1`. |

## Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lob": {
      "command": "npx",
      "args": ["-y", "lob-mcp"],
      "env": {
        "LOB_API_KEY": "test_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The Lob tools should appear in the tool picker.

## Use with Claude Code

```bash
claude mcp add lob --env LOB_API_KEY=test_your_key_here -- npx -y lob-mcp
```

## Use with the MCP Inspector

```bash
npm run inspector
```

Then open the URL printed to your terminal. Set `LOB_API_KEY` in the inspector's environment panel before invoking tools.

## Tool reference

All tools are namespaced `lob_<resource>_<action>`. Annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set per the MCP spec so hosts can render appropriate confirmation prompts for billable / destructive operations.

### Address book

- `lob_addresses_create` · `lob_addresses_list` · `lob_addresses_get` · `lob_addresses_delete`

### Address verification

- `lob_us_verifications_create` · `lob_us_verifications_get`
- `lob_us_autocompletions_create`
- `lob_intl_verifications_create`
- `lob_bulk_us_verifications_create` · `lob_bulk_intl_verifications_create`
- `lob_identity_validation`

### Postcards (billable on create)

- `lob_postcards_create` · `lob_postcards_list` · `lob_postcards_get` · `lob_postcards_cancel`

### Letters (billable on create)

- `lob_letters_create` · `lob_letters_list` · `lob_letters_get` · `lob_letters_cancel`

### Self-mailers (billable on create)

- `lob_self_mailers_create` · `lob_self_mailers_list` · `lob_self_mailers_get` · `lob_self_mailers_cancel`

### Checks (billable on create + draws funds)

- `lob_checks_create` · `lob_checks_list` · `lob_checks_get` · `lob_checks_cancel`

### Templates and template versions

- `lob_templates_create` · `lob_templates_list` · `lob_templates_get` · `lob_templates_update` · `lob_templates_delete`
- `lob_template_versions_create` · `lob_template_versions_list` · `lob_template_versions_get` · `lob_template_versions_update` · `lob_template_versions_delete`

### Campaigns + creatives (live-mode key required)

- `lob_campaigns_create` · `lob_campaigns_list` · `lob_campaigns_get` · `lob_campaigns_update` · `lob_campaigns_delete`
- `lob_creatives_create` · `lob_creatives_get` · `lob_creatives_update` · `lob_creatives_delete`

> **Creative content quirk.** Lob's `/v1/creatives` endpoint accepts only Lob template IDs (`tmpl_…`) for the `front`, `back`, `inside`, `outside`, and `file` content fields — **not** HTML strings or remote URLs (which postcards / letters / self-mailers do accept). To use a URL or HTML as creative content, first call `lob_templates_create` to upload it as a template, then pass the resulting `tmpl_…` here.

### Buckslips, cards, and print orders

- `lob_buckslips_create` · `lob_buckslips_list` · `lob_buckslips_get`
- `lob_buckslip_orders_create` (billable) · `lob_buckslip_orders_list`
- `lob_cards_create` · `lob_cards_list` · `lob_cards_get`
- `lob_card_orders_create` (billable) · `lob_card_orders_list`

> Buckslip and card create endpoints require a publicly-reachable PDF URL with exact dimensions (8.75″×3.75″ for buckslips, 3.375″×2.125″ for cards). Lob's buckslip create accepts only `multipart/form-data` and is sent as such by this server.

### QR codes and resource proofs

- `lob_qr_codes_list`
- `lob_resource_proofs_create` · `lob_resource_proofs_get` · `lob_resource_proofs_update`

### Bank accounts (required to draw checks)

- `lob_bank_accounts_create` · `lob_bank_accounts_list` · `lob_bank_accounts_get` · `lob_bank_accounts_delete` · `lob_bank_accounts_verify`

### Webhooks

- `lob_webhooks_create` · `lob_webhooks_list` · `lob_webhooks_get` · `lob_webhooks_update` · `lob_webhooks_delete`

## Safety model

This server enforces three safety practices appropriate for a real-money API:

1. **Test/live mode detection.** The server inspects your API key prefix at startup and logs the active mode to stderr. A `test_…` key produces no real mail; a `live_…` key produces real, billable mail.
2. **Idempotency.** Every billable create tool exposes an optional `idempotency_key` parameter. Pass a UUID (or any unique string up to 256 characters) per logical request. Lob will return the original response for any subsequent request reusing the same key, preventing duplicate mail on network retries.
3. **PII redaction in errors.** Address, name, and contact fields are stripped from any error payload echoed back to the client. The full request body is never logged; only error metadata (status, code, request id, message) is surfaced.

## The `extra` escape hatch

Lob's API has many resource-specific options that aren't worth enumerating in a tool schema (custom envelope IDs, perforation pages, billing groups, marketing flags, etc.). Every create/update tool accepts an optional `extra` object whose keys are merged verbatim into the request body, with explicitly-typed fields taking precedence:

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
npm run inspector
```

The compiled output lives in `build/`. Source is in `src/`.

## Architecture

```
src/
├── index.ts            # stdio entry — boots McpServer + LobClient
├── env.ts              # env loading + test/live mode detection
├── version.ts          # SERVER_VERSION + USER_AGENT
├── lob/
│   ├── client.ts       # fetch-based HTTP client (Basic auth, idempotency, asForm multipart)
│   ├── errors.ts       # LobApiError + tool-friendly formatter
│   └── redact.ts       # recursive PII redaction
├── schemas/
│   ├── common.ts       # address, pagination, idempotency, metadata schemas
│   └── mail.ts         # mail-piece-shared schemas
└── tools/
    ├── helpers.ts      # registerTool helper with consistent error mapping
    ├── register.ts     # wires every group into the server
    └── *.ts            # one file per resource group
```

The HTTP client is intentionally thin — it does not depend on the official `lob-typescript-sdk`, which keeps the dependency surface small and gives this server tighter control over headers, retries, multipart encoding, and PII handling. New Lob endpoints can be added by registering one more tool against the resource group file (or via the `extra` escape hatch on existing tools).

## Limitations

- **Multipart file uploads from disk** are supported by the underlying client (`asForm: true`) but the user-facing tools accept content via URL, HTML string, or Lob template ID — not a local filesystem path. This covers the documented Lob content-source forms for an LLM-driven workflow.
- **OAuth** is not supported because Lob does not offer it. Auth is HTTP Basic with an API key, per Lob's docs.
- **Some endpoints require a live-mode key**: the campaigns + creatives API and the verification-retrieval endpoint return 403 in test mode.

## Contributing

Issues and pull requests welcome at <https://github.com/optimize-overseas/lob-mcp>.

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

This project is **not** affiliated with, endorsed by, or sponsored by Lob.com. "Lob" is a trademark of Lob.com, Inc. Use of the Lob API is subject to Lob's [Terms of Service](https://www.lob.com/terms-of-service) and [Acceptable Use Policy](https://www.lob.com/acceptable-use-policy).
