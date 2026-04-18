# lob-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server for the [Lob.com](https://lob.com) API. Lets any MCP-compatible LLM (Claude, etc.) verify addresses and send physical mail — postcards, letters, self-mailers, and printed checks — through Lob.

> ⚠️ **Lob produces real physical mail and charges your account.** Mail-piece create tools (`lob_postcards_create`, `lob_letters_create`, `lob_self_mailers_create`, `lob_checks_create`, `lob_*_orders_create`) are billable. Develop with a `test_…` API key. Switch to `live_…` only when you are ready to ship real mail. Always pass an `idempotency_key` so retries don't duplicate sends.

## Features

- **74 tools** across **11 resource groups** covering the Lob v1 API surface:
  - Address book (CRUD)
  - US + international address verification (single, bulk, autocomplete, identity validation)
  - Postcards, letters, self-mailers, checks (create, list, retrieve, cancel)
  - Templates and template versions (CRUD)
  - Campaigns and creatives (CRUD — require live-mode key)
  - Buckslips, cards, and their print orders
  - Informed Delivery campaigns (require live-mode key)
  - QR-code analytics
  - Resource proofs (preview before send)
  - Bank accounts (CRUD + micro-deposit verification)
  - Webhook subscriptions (CRUD)
- **Idempotency** support on every billable create endpoint
- **Test/live mode detection** from API key prefix, surfaced at startup
- **PII redaction** — address fields are stripped from error output
- **Generic `extra` parameter** on every create/update tool — accepts any Lob parameter not enumerated in the schema, so you're never blocked by SDK lag

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

### Templates

- `lob_templates_create` · `lob_templates_list` · `lob_templates_get` · `lob_templates_update` · `lob_templates_delete`
- `lob_template_versions_create` · `lob_template_versions_list` · `lob_template_versions_get` · `lob_template_versions_update` · `lob_template_versions_delete`

### Campaigns + creatives

- `lob_campaigns_create` · `lob_campaigns_list` · `lob_campaigns_get` · `lob_campaigns_update` · `lob_campaigns_delete`
- `lob_creatives_create` · `lob_creatives_list` · `lob_creatives_get` · `lob_creatives_update` · `lob_creatives_delete`

### Buckslips, cards, and print orders (orders are billable)

- `lob_buckslips_create` · `lob_buckslips_list` · `lob_buckslips_get`
- `lob_buckslip_orders_create` · `lob_buckslip_orders_list`
- `lob_cards_create` · `lob_cards_list` · `lob_cards_get`
- `lob_card_orders_create` · `lob_card_orders_list`

### Informed Delivery

- `lob_informed_delivery_campaigns_create` · `lob_informed_delivery_campaigns_list` · `lob_informed_delivery_campaigns_get`

### QR codes + resource proofs

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

Lob's API has many resource-specific options that aren't worth enumerating in a tool schema (custom envelope IDs, perforation pages, billing groups, marketing flags, etc.). Every create/update tool accepts an optional `extra` object whose keys are merged verbatim into the request body:

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
npm run build
npm run typecheck
npm run inspector
```

The compiled output lives in `build/`. Source is in `src/`.

## Architecture

```
src/
├── index.ts            # stdio entry — boots McpServer + LobClient
├── env.ts              # env loading + test/live mode detection
├── lob/
│   ├── client.ts       # fetch-based HTTP client (Basic auth, idempotency, errors)
│   ├── errors.ts       # LobApiError + tool-friendly formatter
│   └── redact.ts       # PII redaction
├── schemas/
│   ├── common.ts       # address, pagination, idempotency, metadata schemas
│   └── mail.ts         # mail-piece-shared schemas
└── tools/
    ├── helpers.ts      # registerTool helper with consistent error mapping
    ├── register.ts     # wires every group into the server
    └── *.ts            # one file per resource group
```

The HTTP client is intentionally thin — it does not depend on the official `lob-typescript-sdk`, which keeps the dependency surface small and gives this server tighter control over headers, retries, and PII handling. New Lob endpoints can be added by registering one more tool against the resource group file (or via the `extra` escape hatch on existing tools).

## Limitations

- **Multipart file uploads** for resources that accept binary PDF/image bytes are supported by the underlying client (`asForm: true`) but not yet exposed in any tool — the current tools accept HTML strings, URLs, template IDs, and base64 data URIs, which covers the documented Lob content-source forms.
- **OAuth** is not supported because Lob does not offer it; auth is HTTP Basic with an API key, per Lob's docs.

## Contributing

Issues and pull requests welcome at <https://github.com/optimize-overseas/lob-mcp>.

## License

MIT — see [LICENSE](./LICENSE).

## Disclaimer

This project is **not** affiliated with, endorsed by, or sponsored by Lob.com. "Lob" is a trademark of Lob.com, Inc. Use of the Lob API is subject to Lob's [Terms of Service](https://www.lob.com/terms-of-service) and [Acceptable Use Policy](https://www.lob.com/acceptable-use-policy).
