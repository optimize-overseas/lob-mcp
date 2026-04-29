# Changelog

## 1.1.0 — 2026-04-29 (Design specs release)

The 1.0 hardening release verified the preview/commit + dual-key + idempotency
path end-to-end with a real test postcard. That postcard's back-side body text
was clipped by Lob's auto-stamped address block — the model had no way to know
about the 3.2835″×2.375″ ink-free zone. 1.1 makes the spec discoverable so
this won't happen again.

### Added

- **12 JSON design-spec resources** at `lob://specs/{mail_type}/{variant}.json`
  covering postcards (4x6, 6x9, 6x11), letters (standard_no10, flat_9x12,
  legal_8.5x14, custom_envelope), self-mailers (6x18_bifold, 11x9_bifold),
  checks (standard), buckslips (standard), and cards (standard). Each spec
  includes dimensions in inches, bleed, safe area, surface descriptions, no-print
  zones with anchor + offset semantics, file-format requirements (PDF/X-1a, CMYK,
  300 DPI, ≤5 MB, embedded fonts), critical_constraints[] strings the model can
  paraphrase into design briefs, and references to Lob's source URL.
- **11 bundled PDF template resources** at `lob://specs/{mail_type}/{variant}.pdf`
  served as base64 blobs from `build/specs/pdfs/`. No external fetch — the
  templates ship with the npm package. Refreshable via
  `scripts/download-spec-pdfs.mjs`. (No PDF for `card/standard` — Lob does not
  publish a standalone card template; the JSON spec covers dimensions.)
- **`lob_design_specs_get(mail_type, variant)` fallback tool** — returns the
  same JSON inline. For hosts that under-implement MCP resources.
- **Inline `design_spec` field in every `*_preview` response.** The model has
  the no-print-zone coordinates in scope when reviewing a Lob proof, so it can
  self-audit before committing.
- `scripts/download-spec-pdfs.mjs` and `scripts/copy-spec-pdfs.mjs` build
  helpers — the build step now packs the PDFs into `build/specs/pdfs/`.

### Tests

- **89 new unit tests** covering: every (mail_type, variant) combo via
  `findSpec`, every PDF resource's file presence and PDF magic-number, every
  fallback-tool data-path lookup, dot-to-underscore filename mapping, and
  bundle cache behavior. Total unit suite: 47 → 136.
- **Integration smoke extended** from 11 → 22 checks against Lob's live test
  API: every JSON URI read, every PDF URI read, every fallback tool variant
  invocation, plus the inline `design_spec` field on postcard and check
  previews. The bug-driver dimensions (3.2835×2.375 back zone on 4x6) are
  asserted explicitly.

### Internal

- Tool count: 76 → 77. Resources: 0 → 23. Total exposed primitives: 76 → 100.

### Future work

- A `lob_design_lint(mail_type, variant, asset_url)` tool that fetches a
  candidate design and validates dimensions, asset reachability, font
  embedding, and no-print-zone overlap.
- MCP prompts for guided design briefs (parameterized).
- Spec for the cards standalone PDF template once Lob publishes one.

## 1.0.0 — 2026-04-29 (Hardening release)

The first stable release. Adds a layered safety harness so an LLM cannot
inadvertently produce expensive or unwanted physical mail.

### Breaking changes

- **`LOB_API_KEY` is replaced** by `LOB_TEST_API_KEY` (always required) and
  `LOB_LIVE_API_KEY` (optional, only needed to send real mail).
  - A `test_…` value in `LOB_API_KEY` is silently accepted as the test key
    (soft fallback for smooth migration).
  - A `live_…` value in `LOB_API_KEY` is rejected with a migration error —
    set `LOB_TEST_API_KEY` and `LOB_LIVE_API_KEY` explicitly.
- **`lob_*_create` (postcards, letters, self_mailers, checks,
  buckslip_orders, card_orders) now requires a `confirmation_token`** from the
  matching `lob_*_preview` tool when running in live mode. Set
  `LOB_REQUIRE_CONFIRMATION=false` to opt out (preserves old behavior, loses
  payload-binding safety).
- **Live mode requires `LOB_LIVE_MODE=true` AND a `LOB_LIVE_API_KEY`.** A live
  key alone no longer enables live mail.

### Added

- Six `lob_*_preview` tools: postcards, letters, self_mailers, checks,
  buckslip_orders, card_orders. Tool count: **76** (was 70).
  - Postcards / letters / self-mailers: real Lob proof PDFs via
    `/resource_proofs`.
  - Checks / inventory orders: textual preview (Lob has no proof endpoint for
    these). Token still binds the payload.
- Dual-key configuration model: previews always use the test key, commits use
  the live key only when `LOB_LIVE_MODE=true`.
- Pluggable `TokenStore` interface with an in-memory default; payload-hash
  binding so committing a different payload than was previewed is rejected
  with `LOB_TOKEN_PAYLOAD_MISMATCH`.
- Mandatory idempotency on every billable POST. Auto-generated when omitted;
  deterministic from the confirmation token when present (`lob-mcp-${token}`)
  so retries de-dupe at Lob automatically.
- `LOB_MAX_PIECES_PER_RUN` exact piece-count cap. Counter resets on restart.
- Narrow elicitation (off by default):
  - `LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD` — fires an MCP elicitation
    form when a check `amount` exceeds the threshold.
  - `LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES` — same for buckslip / card
    inventory orders. Fail-closed when the host doesn't support elicitation.
- Complete tool annotation matrix: every tool sets `readOnlyHint`,
  `destructiveHint`, `idempotentHint`, and `openWorldHint`.
- `lob-mcp init` interactive setup wizard. Prompts for keys + caps; emits
  paste-ready Claude Desktop JSON and `claude mcp add` one-liners.
- Boot-time banner reflecting the full safety posture under each env
  combination.
- New `LobMcpError` taxonomy with codes: `LOB_TOKEN_REQUIRED`,
  `LOB_TOKEN_NOT_FOUND`, `LOB_TOKEN_EXPIRED`, `LOB_TOKEN_PAYLOAD_MISMATCH`,
  `LOB_PIECE_CAP_EXCEEDED`, `LOB_CONFIRMATION_DECLINED`. Each surfaces a
  `Next:` step the model can follow.
- Unit test suite via `node:test` + `tsx` (`npm test`). 47 unit tests + an
  integration smoke (`tests/integration.mjs`) that exercises preview/commit
  end-to-end against Lob's real test API.

### Migration from 0.x

1. **Rename your env var.** `LOB_API_KEY` → `LOB_TEST_API_KEY` (when the value
   begins with `test_`). If you were using a live key in `LOB_API_KEY`, set
   `LOB_LIVE_API_KEY` separately.
2. **To send live mail**, also set `LOB_LIVE_MODE=true`.
3. **To preserve the old single-step flow** (no token gate), set
   `LOB_REQUIRE_CONFIRMATION=false`. Not recommended.
4. **(Recommended)** Run `npx lob-mcp init` for a generated config snippet.

### Removed

- `LOB_API_KEY` is no longer the canonical env var (soft-fallback only for
  `test_` values).

## 0.1.4 and earlier

See git history.
