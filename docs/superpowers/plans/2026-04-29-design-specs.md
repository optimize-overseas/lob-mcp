# Design-Spec Resources Implementation Plan (lob-mcp 1.1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to walk through subsystems sequentially. Steps use checkbox (`- [ ]`) syntax for tracking. **Final delivery is one squashed commit** at the end, then merge into `main`, push, tag `v1.1.0`, publish to npm.

**Goal:** Expose Lob's official mail-piece design specifications (dimensions, bleed, safe areas, no-print zones, file-format requirements, and Lob's reference PDF templates) through the MCP server so AI design tools and the LLM itself can produce print-correct artwork that respects Lob's auto-stamped address blocks and rendering constraints.

**Architecture:** Add a single source-of-truth `SpecManifest` typed module covering every supported `(mail_type, variant)` pair. Expose it three ways: (a) a parameterized MCP **resource template** `lob://specs/{mail_type}/{variant}.json` that returns the spec as structured JSON, (b) static MCP **resource entries** `lob://specs/{mail_type}/{variant}.pdf` that return Lob's official template PDF (bundled in the npm artifact, served as base64 blob), and (c) a thin **fallback tool** `lob_design_specs_get` for hosts that under-implement resources. The existing `*_preview` tools also surface the relevant spec inline in their response so the model has authoritative dimensions in scope when reviewing a proof.

**Tech Stack:** TypeScript / Node 18+ / `@modelcontextprotocol/sdk@^1.22` / Zod v3 / `node:test` + `tsx` for unit tests.

**Delivery:** One commit at the end. Each subsystem smoke-tested. Tool count goes from 76 → 77 (one new fallback tool); resources go from 0 → ~22 (one JSON + one PDF per variant, plus a few extras for letter envelopes and check artifacts). Version bumps **1.0.0 → 1.1.0** (additive feature, non-breaking).

**Live key needed?** No. Specs are static reference data — no Lob API calls. Test key is sufficient for the smoke tests. Final integration smoke runs against `tests/integration.mjs` extended with resource-listing checks.

---

## Critical analysis — design choices baked into this plan

The user's actual problem: the AI generated a postcard back full of text, then got it auto-clipped by Lob's address block + barcode + indicia (visible in the test postcard PDF — the "If you're holding this card, the saf…" cutoff). The model had no idea the back has a 3.2835×2.375" ink-free zone in the lower-right corner. **The plan's success criterion is: a model that calls the new resource/tool before designing knows about that zone and respects it.**

### Decision 1 — Resources, not tools, as the primary surface

The MCP spec splits primitives by control surface: **tools** are model-driven, **resources** are user/host-driven. Design specs are reference material a host should be able to surface in a picker and let a user attach to chat context. Existing MCPs that expose technical reference (OpenAPI specs, docs) use resources; existing MCPs that expose API actions (Stripe, filesystem) use tools. We do both — actions stay tools, specs become resources.

### Decision 2 — Bundle PDFs, don't link to Lob's S3

The MCP spec discourages `https://` URIs unless "the client is able to fetch and load the resource directly from the web on its own." That assumes network policy / auth / offline don't break the link. Lob hosts the PDF templates on `s3-us-west-2.amazonaws.com/public.lob.com/...` URLs that look stable but aren't versioned. **Bundle them in the npm artifact**, serve as base64 blob through the resource. Trade-off: ~3-4 MB added to the package (currently 54 KB → ~4 MB). Acceptable for an npm package; this is offline-safe and Lob can't break our URIs.

We still surface Lob's S3 URL in the resource metadata as `provenance` so users can verify against current Lob source.

### Decision 3 — Thin fallback tool, not zero tools

In Q1 2026 not every MCP host implements resources well (Cursor partial, custom agent frameworks worse). A single thin `lob_design_specs_get(mail_type, variant)` tool gives the model agent-driven access to the same JSON the resource template returns. Single backing data, two surfaces, near-zero implementation cost.

### Decision 4 — JSON schema designed for LLM consumption

The JSON shape isn't just "Lob's spec serialized." It's restructured for an LLM that's about to generate HTML or a PDF:

- `critical_constraints[]` — short, quotable strings the model should literally paraphrase into its plan ("The back of a 4×6 postcard has a 3.2835″×2.375″ ink-free zone in the lower-right corner. Do NOT place text or critical artwork there.").
- `surfaces[]` — per side (front, back, inside, outside), with `no_print_zones[]` having anchor + offset semantics so a CSS author can compute pixel coordinates from inches.
- `file_requirements{}` — flat field set: `pdf_x1a`, `min_dpi_raster`, `max_file_size_mb`, `color_space_preferred`, `fonts`.
- `human_readable_summary` — 2-3 sentence English summary the model can quote into a design brief.
- `references{}` — both the bundled MCP resource URI and Lob's S3 source URL.

### Decision 5 — Expose the spec inline in `*_preview` responses

Every billable preview already returns `{confirmation_token, expires_at, preview}`. Add a `design_spec` field — the same JSON the resource template would return for this `(mail_type, variant)`. This means the model has the authoritative no-print zone in scope when it reviews the rendered proof, without needing a separate fetch. **This is the highest-value change in the plan** because it operationalizes specs into the existing flow rather than relying on the model to remember to fetch them.

### Decision 6 — No prompts in v1

MCP prompts are user-invoked slash-commands. A `/design-postcard` prompt is plausible, but design briefs are too domain-specific to template usefully ("design a postcard for X audience" varies wildly per use case). Skip; reconsider in v2 if there's demand.

### Decision 7 — A linter is v2

A `lob_design_lint(mail_type, variant, asset_url)` that fetches a candidate design and runs checks (PDF dimensions, asset reachability, font embedding) is valuable but high-effort (PDF parsing, headless rendering for HTML). Out of scope for 1.1; tracked as a future enhancement in CHANGELOG.

### Variants we cover

Aligned with what lob-mcp's existing tools actually accept:

| `mail_type` | `variant` values |
|---|---|
| `postcard` | `4x6`, `6x9`, `6x11` |
| `letter` | `standard_no10`, `flat_9x12` (>6 sheets), `legal_8.5x14`, `custom_envelope` |
| `self_mailer` | `6x18_bifold`, `11x9_bifold` |
| `check` | `standard` (default; covers check-bottom + attachment + logo) |
| `buckslip` | `standard` (8.75x3.75) |
| `card` | `standard` (3.375x2.125) |

The 4 letter variants need 4 different specs because the safe areas differ per envelope/sheet-count combination. Not exposing 5x7 postcards because lob-mcp's existing `lob_postcards_create` tool doesn't accept that size.

---

## File structure (new + changed)

```
src/
├── specs/                              # NEW
│   ├── manifest.ts                     # typed SpecManifest schema + all spec data, source-of-truth
│   ├── pdf-loader.ts                   # reads bundled PDFs, returns {bytes, mimeType}, caches in-process
│   └── register.ts                     # registers resources (template + static) + fallback tool
├── tools/
│   ├── postcards.ts                    # MODIFY: thread spec into preview response
│   ├── letters.ts                      # MODIFY: same
│   ├── self-mailers.ts                 # MODIFY: same
│   ├── checks.ts                       # MODIFY: same
│   ├── uploads.ts                      # MODIFY: same for buckslip + card orders
│   └── register.ts                     # MODIFY: call registerSpecsResources()
├── index.ts                            # MODIFY: declare resources capability on McpServer
build/specs/pdfs/                       # populated by build step, packed in npm artifact
specs/pdfs/                             # NEW (in repo): bundled Lob PDF templates
│   ├── postcard-4x6.pdf
│   ├── postcard-6x9.pdf
│   ├── postcard-6x11.pdf
│   ├── letter-standard-no10.pdf
│   ├── letter-flat-9x12.pdf
│   ├── letter-legal-8.5x14.pdf
│   ├── letter-no10-envelope.pdf
│   ├── self-mailer-6x18-bifold.pdf
│   ├── self-mailer-11x9-bifold.pdf
│   ├── check-bottom.pdf
│   ├── check-attachment.pdf
│   └── buckslip.pdf
scripts/
├── download-spec-pdfs.mjs              # NEW: one-shot fetch from Lob's S3 (run by maintainer once)
└── copy-spec-pdfs.mjs                  # NEW: build step — copies specs/pdfs/ → build/specs/pdfs/
tests/unit/
├── specs-manifest.test.ts              # NEW: every variant has all required fields, dimensions positive, etc.
└── specs-resources.test.ts             # NEW: resource list/read returns valid shapes
tests/
└── integration.mjs                     # MODIFY: add resource-listing checks + design_spec inline check
docs/
└── superpowers/plans/2026-04-29-design-specs.md   # this file
package.json                            # MODIFY: build step copies specs, version 1.1.0, files: ["build"] still covers
README.md                               # MODIFY: add Design Specs section
CHANGELOG.md                            # MODIFY: 1.1.0 entry
CLAUDE.md                               # MODIFY: bump tool count, document specs subsystem
```

The `specs/pdfs/` directory at repo root (not under `src/`) is intentional — these are static assets, not source. They get copied into `build/specs/pdfs/` by the build step so they ship in the npm tarball (`"files": ["build"]` already covers).

---

## Pre-flight: download Lob's PDF templates

### Task 0.1: Write the one-shot download script

**Files:**
- Create: `scripts/download-spec-pdfs.mjs`

The download URLs are stable (S3 public buckets) but should be fetched once by the maintainer and committed. The script is idempotent — re-running just refreshes from Lob.

- [ ] **Step 1: Implement the download script**

```js
// scripts/download-spec-pdfs.mjs
#!/usr/bin/env node
/**
 * One-shot: download Lob's official template PDFs into specs/pdfs/.
 * Maintainer runs this once; PDFs are committed to git and packed in npm.
 * Re-run to refresh if Lob updates a template.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "specs/pdfs");
fs.mkdirSync(outDir, { recursive: true });

// Filenames follow `{mail_type}-{variant}.pdf` where dots in variants are
// replaced with underscores. The pdf-loader uses the same mapping.
const TEMPLATES = [
  ["postcard-4x6.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/4x6_postcard.pdf"],
  ["postcard-6x9.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x9_postcard.pdf"],
  ["postcard-6x11.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x11_postcard.pdf"],
  ["letter-standard_no10.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_template_updated+4_25.pdf"],
  ["letter-flat_9x12.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_flat_template_updated+4_25.pdf"],
  ["letter-legal_8_5x14.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/Legal_Letter_updated_4_25.pdf"],
  ["letter-custom_envelope.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/no10_env_template.pdf"],
  ["self_mailer-6x18_bifold.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/6x18_sfm_bifold_template.pdf"],
  ["self_mailer-11x9_bifold.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/11x9_sfm_bifold_template.pdf"],
  ["check-standard.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/check_bottom_template.pdf"],
  ["buckslip-standard.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/buckslip_template.pdf"],
  // No card template — Lob does not publish a standalone PDF for cards.
];

let failures = 0;
for (const [name, url] of TEMPLATES) {
  const dest = path.join(outDir, name);
  process.stdout.write(`${name} … `);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FAIL HTTP ${res.status}`);
      failures++;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.log(`ERROR ${err.message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} template(s) failed to download. Check Lob URLs.`);
  process.exit(1);
}
console.log(`\n${TEMPLATES.length} templates downloaded to ${outDir}`);
```

- [ ] **Step 2: Run it**

```bash
node scripts/download-spec-pdfs.mjs
ls -la specs/pdfs/
```

Expected: 11 PDFs downloaded, sizes between ~30 KB and ~500 KB each, total ≈3-4 MB. (Lob publishes 12 templates but `check_attachment_template.pdf` is a sub-artifact of the standard check spec, not a separate variant — it's referenced from the manifest's `notes` rather than served as its own resource.)

- [ ] **Step 3: Verify each PDF opens and is the right resource type**

Spot-check a few:
```bash
file specs/pdfs/postcard-4x6.pdf
file specs/pdfs/check-bottom.pdf
```

Expected: each reports "PDF document, version 1.x, ..." with non-zero page count.

If any download failed (404, 403), STOP and surface the URL to the user — Lob may have rotated an asset.

---

## Subsystem 1: SpecManifest module

### Task 1.1: Define the typed schema

**Files:**
- Create: `src/specs/manifest.ts`

The manifest is the single source of truth. Every entry contains the data we extracted from Lob's help center, expressed as plain TypeScript with const-asserted types so the compiler enforces completeness.

- [ ] **Step 1: Write the typed schema**

```ts
// src/specs/manifest.ts
/**
 * Lob mail-piece design specifications.
 *
 * Single source of truth. The MCP resources, the fallback tool, and the
 * inline-into-preview-response code path all read from here.
 *
 * Every dimension is in inches unless noted (Lob's published units). For a
 * design tool that needs pixels, multiply by 72 (PDF) or 300 (CMYK print
 * raster). The `human_readable_summary` is what the model should literally
 * paraphrase into design briefs.
 */

export type MailType =
  | "postcard"
  | "letter"
  | "self_mailer"
  | "check"
  | "buckslip"
  | "card";

export type Anchor =
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "top_center"
  | "bottom_center"
  | "center";

export interface RectIn {
  width_in: number;
  height_in: number;
}

export interface NoPrintZone {
  /** What Lob places here. Helps the model reason about why the zone exists. */
  purpose:
    | "address_block_and_indicia"
    | "address_block"
    | "indicia_only"
    | "imb_barcode"
    | "logo_box"
    | "perforation_strip"
    | "fold_safe_margin";
  width_in: number;
  height_in: number;
  anchor: Anchor;
  /** Distance from the anchor edge to the nearest edge of the zone. */
  offset_from_anchor_in: { x: number; y: number };
  notes?: string;
}

export interface Surface {
  /** Side of the piece this surface refers to. */
  name:
    | "front"
    | "back"
    | "inside"
    | "outside"
    | "page_1"
    | "page_subsequent"
    | "envelope_face"
    | "check_face"
    | "check_bottom"
    | "attachment";
  fully_designable: boolean;
  no_print_zones: NoPrintZone[];
  notes?: string;
}

export interface FileRequirements {
  pdf_x1a: boolean;
  color_space_preferred: "CMYK" | "RGB" | "B&W";
  /** Set when the surface mandates B&W (e.g. check_bottom, attachment). */
  color_space_required?: "CMYK" | "RGB" | "B&W";
  min_dpi_raster: number;
  max_file_size_mb: number;
  fonts:
    | "embedded_or_outlined"
    | "embedded_or_outlined_no_type1_no_type3";
  printer_marks_allowed: false;
  transparency_must_be_flattened: true;
}

export interface SpecReferences {
  /** URI of the bundled PDF resource served by this MCP. */
  mcp_resource_uri: string | null;
  /** Lob's hosted source URL for provenance. Subject to change. */
  lob_source_url: string | null;
  /** Lob help center page documenting this spec. */
  lob_docs_url: string;
}

export interface DesignSpec {
  mail_type: MailType;
  variant: string;
  /** Compact title for picker UI. */
  title: string;
  /** 2-3 sentence English summary. The model paraphrases this into design briefs. */
  human_readable_summary: string;
  /** Short, quotable strings. Each is a hard rule the model MUST respect. */
  critical_constraints: string[];
  trim: RectIn;
  bleed: RectIn | null;
  safe_area: RectIn;
  surfaces: Surface[];
  file_requirements: FileRequirements;
  /** Lob-specific gotchas that aren't dimension-based. */
  notes: string[];
  references: SpecReferences;
}

const DEFAULT_FILE_REQUIREMENTS: FileRequirements = {
  pdf_x1a: true,
  color_space_preferred: "CMYK",
  min_dpi_raster: 300,
  max_file_size_mb: 5,
  fonts: "embedded_or_outlined",
  printer_marks_allowed: false,
  transparency_must_be_flattened: true,
};

const POSTCARD_BACK_NO_PRINT: NoPrintZone = {
  purpose: "address_block_and_indicia",
  width_in: 4.0,
  height_in: 2.375,
  anchor: "bottom_right",
  offset_from_anchor_in: { x: 0.275, y: 0.25 },
  notes:
    "Lob auto-stamps the recipient address, IMb data-matrix barcode, and postage indicia here. Do NOT place text or critical artwork inside this zone.",
};

const POSTCARD_4X6_BACK_ZONE: NoPrintZone = {
  ...POSTCARD_BACK_NO_PRINT,
  width_in: 3.2835,
  height_in: 2.375,
};

export const SPEC_MANIFEST: readonly DesignSpec[] = [
  // ── Postcards ─────────────────────────────────────────────────────────────
  {
    mail_type: "postcard",
    variant: "4x6",
    title: "Postcard 4×6",
    human_readable_summary:
      "A 4″×6″ postcard, full-bleed both sides. The front is fully designable. The back has a 3.2835″×2.375″ ink-free zone in the lower-right corner where Lob stamps the recipient address, IMb barcode, and postage indicia — do not place text or critical artwork there.",
    critical_constraints: [
      "Trim is 4″×6″; full bleed area is 4.25″×6.25″ (1/8″ bleed on every edge).",
      "Safe zone (keep critical content inside) is 3.875″×5.875″.",
      "The back has a 3.2835″×2.375″ ink-free zone anchored to the bottom-right corner with 0.275″ horizontal and 0.25″ vertical offset from the trim edge.",
      "Do NOT include personally identifying information outside the back ink-free zone.",
    ],
    trim: { width_in: 4.0, height_in: 6.0 },
    bleed: { width_in: 4.25, height_in: 6.25 },
    safe_area: { width_in: 3.875, height_in: 5.875 },
    surfaces: [
      { name: "front", fully_designable: true, no_print_zones: [] },
      { name: "back", fully_designable: false, no_print_zones: [POSTCARD_4X6_BACK_ZONE] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 100#–120# cover (255–325 GSM), 1-side UV gloss, full bleed, carbon-neutral.",
      "Only the 4×6 size ships internationally.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/postcard/4x6.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/4x6_postcard.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/postcards",
    },
  },
  {
    mail_type: "postcard",
    variant: "6x9",
    title: "Postcard 6×9",
    human_readable_summary:
      "A 6″×9″ postcard, full-bleed both sides. The front is fully designable. The back has a 4″×2.375″ ink-free zone in the lower-right corner where Lob stamps the recipient address, IMb barcode, and postage indicia — do not place text or critical artwork there.",
    critical_constraints: [
      "Trim is 6″×9″; full bleed area is 6.25″×9.25″.",
      "Safe zone is 5.875″×8.875″.",
      "The back has a 4″×2.375″ ink-free zone anchored to the bottom-right with 0.275″ horizontal and 0.25″ vertical offset.",
      "Do NOT include personally identifying information outside the back ink-free zone.",
    ],
    trim: { width_in: 6.0, height_in: 9.0 },
    bleed: { width_in: 6.25, height_in: 9.25 },
    safe_area: { width_in: 5.875, height_in: 8.875 },
    surfaces: [
      { name: "front", fully_designable: true, no_print_zones: [] },
      { name: "back", fully_designable: false, no_print_zones: [POSTCARD_BACK_NO_PRINT] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 100#–120# cover (255–325 GSM), 1-side UV gloss, full bleed, carbon-neutral.",
      "Domestic only.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/postcard/6x9.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x9_postcard.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/postcards",
    },
  },
  {
    mail_type: "postcard",
    variant: "6x11",
    title: "Postcard 6×11",
    human_readable_summary:
      "A 6″×11″ postcard, full-bleed both sides. The front is fully designable. The back has a 4″×2.375″ ink-free zone in the lower-right corner where Lob stamps the recipient address, IMb barcode, and postage indicia — do not place text or critical artwork there.",
    critical_constraints: [
      "Trim is 6″×11″; full bleed area is 6.25″×11.25″.",
      "Safe zone is 5.875″×10.875″.",
      "The back has a 4″×2.375″ ink-free zone anchored to the bottom-right with 0.275″ horizontal and 0.25″ vertical offset.",
      "Do NOT include personally identifying information outside the back ink-free zone.",
    ],
    trim: { width_in: 6.0, height_in: 11.0 },
    bleed: { width_in: 6.25, height_in: 11.25 },
    safe_area: { width_in: 5.875, height_in: 10.875 },
    surfaces: [
      { name: "front", fully_designable: true, no_print_zones: [] },
      { name: "back", fully_designable: false, no_print_zones: [POSTCARD_BACK_NO_PRINT] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 100#–120# cover (255–325 GSM), 1-side UV gloss, full bleed, carbon-neutral.",
      "Domestic only.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/postcard/6x11.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x11_postcard.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/postcards",
    },
  },

  // ── Letters ───────────────────────────────────────────────────────────────
  {
    mail_type: "letter",
    variant: "standard_no10",
    title: "Letter — standard #10 double-window envelope",
    human_readable_summary:
      "Standard 8.5″×11″ letter mailed in a #10 double-window envelope. The first page must reserve a 3.15″×2″ address block 0.6″ from the left and 0.84″ from the top so the recipient address shows through the bottom envelope window. Page edges need 1/16″ clear margin (no full-bleed). Up to 6 sheets per piece.",
    critical_constraints: [
      "Page is 8.5″×11″ with NO bleed (1/16″ clear space on every edge).",
      "Page 1 reserves a 3.15″×2″ address block at 0.6″ from left, 0.84″ from top — keep this area blank.",
      "Up to 6 tri-folded sheets fit in a #10 envelope; >6 sheets switches to a 9″×12″ flat envelope (separate spec).",
      "address_placement: top_first_page (default — Lob stamps in the page-1 block) or insert_blank_page (Lob prepends a blank, billable as an extra sheet).",
      "Logo must fit inside the blue box on the template; cannot overlap the red address-block box.",
    ],
    trim: { width_in: 8.5, height_in: 11.0 },
    bleed: null,
    safe_area: { width_in: 8.375, height_in: 10.875 },
    surfaces: [
      {
        name: "page_1",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block",
            width_in: 3.15,
            height_in: 2.0,
            anchor: "top_left",
            offset_from_anchor_in: { x: 0.6, y: 0.84 },
            notes:
              "Recipient address shows through the envelope window. Lob stamps here when address_placement=top_first_page.",
          },
        ],
      },
      { name: "page_subsequent", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 60# text.",
      "Card or buckslip inserts available; both incompatible with Certified or Registered Mail.",
      "Buckslip insert counts as 1 sheet (max 5 letter sheets + 1 buckslip = 6 total).",
    ],
    references: {
      mcp_resource_uri: "lob://specs/letter/standard_no10.pdf",
      lob_source_url:
        "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_template_updated+4_25.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letters",
    },
  },
  {
    mail_type: "letter",
    variant: "flat_9x12",
    title: "Letter — 9×12 flat single-window envelope (>6 sheets)",
    human_readable_summary:
      "8.5″×11″ letters that exceed 6 sheets ship flat (unfolded) in a 9″×12″ single-window envelope. Up to 60 sheets per piece. The page-1 address block requirement is the same as the standard variant.",
    critical_constraints: [
      "Page is 8.5″×11″ with NO bleed.",
      "Page 1 reserves the same 3.15″×2″ address block at 0.6″ from left, 0.84″ from top.",
      "Up to 60 sheets per piece.",
      "Pages are not folded.",
    ],
    trim: { width_in: 8.5, height_in: 11.0 },
    bleed: null,
    safe_area: { width_in: 8.375, height_in: 10.875 },
    surfaces: [
      {
        name: "page_1",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block",
            width_in: 3.15,
            height_in: 2.0,
            anchor: "top_left",
            offset_from_anchor_in: { x: 0.6, y: 0.84 },
          },
        ],
      },
      { name: "page_subsequent", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: ["Paper: 60# text.", "Use this variant when sheet count exceeds 6."],
    references: {
      mcp_resource_uri: "lob://specs/letter/flat_9x12.pdf",
      lob_source_url:
        "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_flat_template_updated+4_25.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letters",
    },
  },
  {
    mail_type: "letter",
    variant: "legal_8.5x14",
    title: "Letter — 8.5×14 legal (Enterprise)",
    human_readable_summary:
      "8.5″×14″ legal-size letter, Enterprise plans only. Max 3 sheets per piece. Page-1 address block requirement is the same as the standard letter spec.",
    critical_constraints: [
      "Page is 8.5″×14″ with NO bleed.",
      "Page 1 reserves the 3.15″×2″ address block at 0.6″ from left, 0.84″ from top.",
      "Maximum 3 sheets per piece.",
      "Enterprise plans only.",
    ],
    trim: { width_in: 8.5, height_in: 14.0 },
    bleed: null,
    safe_area: { width_in: 8.375, height_in: 13.875 },
    surfaces: [
      {
        name: "page_1",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block",
            width_in: 3.15,
            height_in: 2.0,
            anchor: "top_left",
            offset_from_anchor_in: { x: 0.6, y: 0.84 },
          },
        ],
      },
      { name: "page_subsequent", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: ["Paper: 60# text.", "Enterprise feature; confirm account level before designing."],
    references: {
      mcp_resource_uri: "lob://specs/letter/legal_8.5x14.pdf",
      lob_source_url:
        "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/Legal_Letter_updated_4_25.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letters",
    },
  },
  {
    mail_type: "letter",
    variant: "custom_envelope",
    title: "Letter — custom envelope (Enterprise)",
    human_readable_summary:
      "Custom-printed outer envelope for letters, Enterprise plans only. The envelope face is 4.125″×9.5″ (#10 size). Window cutouts at fixed positions reveal the page-1 address block and an optional sender block. Limit images to ≤25% ink saturation; preferred CMYK; full-bleed allowed up to 0.125″ past trim.",
    critical_constraints: [
      "Envelope face: 4.125″×9.5″ (#10).",
      "Recipient window: 1.0″×4.0″, 0.625″ from left, 1.0″ from bottom.",
      "Sender window: 0.875″×3.25″, 0.625″ from left, 2.375″ from bottom.",
      "All images must be at or under 25% ink saturation.",
      "Bleed extends 0.125″ past trim; non-bleed art must stay 0.125″ inside trim.",
      "Enterprise plans only.",
    ],
    trim: { width_in: 9.5, height_in: 4.125 },
    bleed: { width_in: 9.75, height_in: 4.375 },
    safe_area: { width_in: 9.25, height_in: 3.875 },
    surfaces: [
      {
        name: "envelope_face",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block",
            width_in: 4.0,
            height_in: 1.0,
            anchor: "bottom_left",
            offset_from_anchor_in: { x: 0.625, y: 1.0 },
            notes: "Recipient window — must reveal the address printed on letter page 1.",
          },
          {
            purpose: "address_block",
            width_in: 3.25,
            height_in: 0.875,
            anchor: "bottom_left",
            offset_from_anchor_in: { x: 0.625, y: 2.375 },
            notes: "Sender window — optional, reveals return address area on the letter or insert.",
          },
        ],
      },
    ],
    file_requirements: {
      ...DEFAULT_FILE_REQUIREMENTS,
    },
    notes: [
      "AI/INDD/PSD accepted in addition to PDF.",
      "Custom envelopes cannot be combined with affixed-card-insert letters.",
      "Material: embossed 24# white wove with vertical grooves and blue security tint.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/letter/custom_envelope.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/no10_env_template.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letter-envelopes",
    },
  },

  // ── Self-mailers ──────────────────────────────────────────────────────────
  {
    mail_type: "self_mailer",
    variant: "6x18_bifold",
    title: "Self-mailer 6×18 bifold (folds to 6×9)",
    human_readable_summary:
      "Folded, tabbed self-mailer. Unfolded sheet 6″×18″, folds to a 6″×9″ piece. The outside has a 4″×2.375″ address block on the left panel where Lob stamps the recipient address — keep that area blank.",
    critical_constraints: [
      "Unfolded trim 6″×18″; full bleed 6.25″×18.25″.",
      "Folds to 6″×9″ (one center fold).",
      "Outside left panel reserves a 4″×2.375″ address block, 0.15″ from the center fold and 0.25″ from the bottom edge.",
      "Inside is fully designable.",
      "Submit ALL panels facing upright — Lob inverts inside panels at print.",
    ],
    trim: { width_in: 6.0, height_in: 18.0 },
    bleed: { width_in: 6.25, height_in: 18.25 },
    safe_area: { width_in: 5.875, height_in: 17.875 },
    surfaces: [
      {
        name: "outside",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block_and_indicia",
            width_in: 4.0,
            height_in: 2.375,
            anchor: "bottom_left",
            offset_from_anchor_in: { x: 0.15, y: 0.25 },
            notes:
              "Located on the left outside panel after folding. Lob stamps the recipient address, IMb barcode, and postage indicia here.",
          },
        ],
      },
      { name: "inside", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 80# cover gloss (218 GSM), 1-side UV gloss, full bleed.",
      "Tabbed/glued at fold edges by Lob.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/self_mailer/6x18_bifold.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/6x18_sfm_bifold_template.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/self-mailers",
    },
  },
  {
    mail_type: "self_mailer",
    variant: "11x9_bifold",
    title: "Self-mailer 11×9 bifold (folds to 6×9)",
    human_readable_summary:
      "Folded, tabbed self-mailer. Unfolded sheet 11″×9″, folds to a 6″×9″ piece via a vertical fold with a 1″ flap offset. The outside has a 4″×2.375″ address block on the top panel where Lob stamps the recipient address — keep that area blank.",
    critical_constraints: [
      "Unfolded trim 11″×9″; full bleed approximately 11.25″×9.25″.",
      "Folds to 6″×9″ via vertical fold with 1″ flap offset.",
      "Outside top panel reserves a 4″×2.375″ address block, 0.15″ from the fold and 0.25″ from the right edge.",
      "Inside is fully designable.",
      "Submit ALL panels facing upright — Lob inverts inside panels at print.",
    ],
    trim: { width_in: 11.0, height_in: 9.0 },
    bleed: { width_in: 11.25, height_in: 9.25 },
    safe_area: { width_in: 10.875, height_in: 8.875 },
    surfaces: [
      {
        name: "outside",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "address_block_and_indicia",
            width_in: 4.0,
            height_in: 2.375,
            anchor: "top_right",
            offset_from_anchor_in: { x: 0.25, y: 0.15 },
          },
        ],
      },
      { name: "inside", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Paper: 80# cover gloss, 1-side UV gloss, full bleed.",
      "Vertical fold with 1″ flap; tabbed by Lob.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/self_mailer/11x9_bifold.pdf",
      lob_source_url:
        "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/11x9_sfm_bifold_template.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/self-mailers",
    },
  },

  // ── Checks ────────────────────────────────────────────────────────────────
  {
    mail_type: "check",
    variant: "standard",
    title: "Check (standard, 8.5×11 page with check_bottom)",
    human_readable_summary:
      "Lob-controlled check page on 8.5″×11″ stock with security features (warning bands, void pantograph, fugitive ink). The top 8.5″×3.625″ block is the check itself and must remain blank in your artwork — Lob prints the MICR line and check details there. Designers control the optional logo on the check face, the check_bottom artwork (B&W only) below the check, and the optional attachment (separate B&W document, max 5 sheets / 10 double-sided pages).",
    critical_constraints: [
      "Page is 8.5″×11″.",
      "Top 8.5″×3.625″ block reserved for the check itself — must be blank in your artwork.",
      "check_bottom occupies the bottom 2/3 of the page; B&W only; must follow the template to keep MICR valid.",
      "attachment max 5 sheets / 10 double-sided pages; B&W only.",
      "Logo (optional) added via API only; fits in the published logo region on the check face.",
      "Mailed First Class only in a #10 double-window envelope.",
      "from address is REQUIRED.",
    ],
    trim: { width_in: 8.5, height_in: 11.0 },
    bleed: null,
    safe_area: { width_in: 8.375, height_in: 10.875 },
    surfaces: [
      {
        name: "check_face",
        fully_designable: false,
        no_print_zones: [
          {
            purpose: "logo_box",
            width_in: 1.5,
            height_in: 0.75,
            anchor: "top_left",
            offset_from_anchor_in: { x: 0.5, y: 0.5 },
            notes:
              "Approximate logo region on the check face. Exact dimensions in Lob's authenticated API reference; defer to Lob's spec for precise placement.",
          },
        ],
        notes:
          "The check_face is Lob-controlled. The only design surface here is the optional logo, added via the create-call payload.",
      },
      {
        name: "check_bottom",
        fully_designable: true,
        no_print_zones: [],
        notes:
          "Bottom 2/3 of the check page. Black-and-white only. Pairs naturally with merge_variables for templated stubs.",
      },
      {
        name: "attachment",
        fully_designable: true,
        no_print_zones: [],
        notes: "Separate B&W document inserted in the envelope after the check page.",
      },
    ],
    file_requirements: {
      ...DEFAULT_FILE_REQUIREMENTS,
      color_space_required: "B&W",
    },
    notes: [
      "Security features (Lob-applied): warning bands, void pantograph, security weaver on back, fugitive ink, prismatic background, padlock icon.",
      "Lob does not produce check proofs — the lob_checks_preview tool returns a textual summary only.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/check/standard.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/check_bottom_template.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/checks",
    },
  },

  // ── Buckslips ─────────────────────────────────────────────────────────────
  {
    mail_type: "buckslip",
    variant: "standard",
    title: "Buckslip 8.75×3.75",
    human_readable_summary:
      "Standalone 8.75″×3.75″ promotional buckslip. Both sides fully designable. Trim equals bleed (Lob does not specify additional outer bleed). Keep critical art ≥0.125″ inside the trim line because of press movement.",
    critical_constraints: [
      "Trim and bleed both 8.75″×3.75″.",
      "Safe inset 0.125″ from every edge.",
      "Both sides fully designable.",
      "Print-order tool uses `quantity_ordered` (NOT `quantity` — that's cards).",
      "Lob's /v1/buckslips endpoint requires multipart/form-data; the lob-mcp tool handles this automatically.",
    ],
    trim: { width_in: 8.75, height_in: 3.75 },
    bleed: { width_in: 8.75, height_in: 3.75 },
    safe_area: { width_in: 8.5, height_in: 3.5 },
    surfaces: [
      { name: "front", fully_designable: true, no_print_zones: [] },
      { name: "back", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "5,000 minimum per campaign; ~4-day SLA.",
      "Different from the buckslip-INSERT spec (8.5″×3.5″) used inside letters.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/buckslip/standard.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/buckslip_template.pdf",
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letter-add-ons",
    },
  },

  // ── Cards ─────────────────────────────────────────────────────────────────
  {
    mail_type: "card",
    variant: "standard",
    title: "Card 3.375×2.125 (business-card / gift-card sized)",
    human_readable_summary:
      "Small printed card, 3.375″×2.125″ with 0.125″ rounded corners. Both sides designable. Coated 2 sides with gloss varnish on 18–24pt card stock, full bleed. Lob does not publish a standalone PDF template for cards — design against these dimensions and the letter-add-on guidance.",
    critical_constraints: [
      "Trim 3.375″×2.125″ with 0.125″ rounded corners.",
      "Safe inset 0.125″ from every edge.",
      "Print-order tool uses `quantity` (NOT `quantity_ordered` — that's buckslips).",
      "Cards CANNOT be combined with custom envelopes or buckslips when used as a letter insert.",
    ],
    trim: { width_in: 3.375, height_in: 2.125 },
    bleed: { width_in: 3.625, height_in: 2.375 },
    safe_area: { width_in: 3.125, height_in: 1.875 },
    surfaces: [
      { name: "front", fully_designable: true, no_print_zones: [] },
      { name: "back", fully_designable: true, no_print_zones: [] },
    ],
    file_requirements: DEFAULT_FILE_REQUIREMENTS,
    notes: [
      "Coated 2 sides, gloss varnish, 18–24pt card stock.",
      "5,000 minimum per campaign; 20-day lead time when used as a letter insert.",
      "No standalone PDF template published by Lob — refer to letter-add-on docs for canonical dimensions.",
    ],
    references: {
      mcp_resource_uri: null,
      lob_source_url: null,
      lob_docs_url:
        "https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letter-add-ons",
    },
  },
];

/** Lookup helper. Returns null if no exact match. */
export function findSpec(mail_type: string, variant: string): DesignSpec | null {
  return (
    SPEC_MANIFEST.find(
      (s) => s.mail_type === mail_type && s.variant === variant,
    ) ?? null
  );
}

/** All variants for a given mail_type, in declared order. */
export function variantsFor(mail_type: MailType): readonly DesignSpec[] {
  return SPEC_MANIFEST.filter((s) => s.mail_type === mail_type);
}

/** All mail types declared in the manifest, in declared order, deduplicated. */
export function listMailTypes(): readonly MailType[] {
  const seen = new Set<MailType>();
  const out: MailType[] = [];
  for (const s of SPEC_MANIFEST) {
    if (!seen.has(s.mail_type)) {
      seen.add(s.mail_type);
      out.push(s.mail_type);
    }
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

### Task 1.2: Manifest unit tests

**Files:**
- Create: `tests/unit/specs-manifest.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/specs-manifest.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SPEC_MANIFEST,
  findSpec,
  variantsFor,
  listMailTypes,
} from "../../src/specs/manifest.js";

describe("SPEC_MANIFEST", () => {
  it("contains 12 expected (mail_type, variant) entries", () => {
    assert.equal(SPEC_MANIFEST.length, 12);
  });

  it("every entry has a non-empty title and summary", () => {
    for (const s of SPEC_MANIFEST) {
      assert.ok(s.title.length > 0, `empty title for ${s.mail_type}/${s.variant}`);
      assert.ok(
        s.human_readable_summary.length > 80,
        `summary too short for ${s.mail_type}/${s.variant}`,
      );
    }
  });

  it("every entry has at least one critical_constraint", () => {
    for (const s of SPEC_MANIFEST) {
      assert.ok(
        s.critical_constraints.length > 0,
        `no constraints for ${s.mail_type}/${s.variant}`,
      );
    }
  });

  it("every dimension is positive", () => {
    for (const s of SPEC_MANIFEST) {
      assert.ok(s.trim.width_in > 0 && s.trim.height_in > 0);
      if (s.bleed) {
        assert.ok(s.bleed.width_in >= s.trim.width_in);
        assert.ok(s.bleed.height_in >= s.trim.height_in);
      }
      assert.ok(s.safe_area.width_in <= s.trim.width_in);
      assert.ok(s.safe_area.height_in <= s.trim.height_in);
    }
  });

  it("every no-print zone fits inside its surface", () => {
    for (const s of SPEC_MANIFEST) {
      for (const surf of s.surfaces) {
        for (const z of surf.no_print_zones) {
          // x and y offsets + zone size must not exceed the trim dimensions.
          const totalW = z.width_in + z.offset_from_anchor_in.x;
          const totalH = z.height_in + z.offset_from_anchor_in.y;
          assert.ok(
            totalW <= s.trim.width_in + 0.001 || totalW <= s.bleed?.width_in!,
            `${s.mail_type}/${s.variant} zone ${z.purpose} overflows width: ${totalW} vs ${s.trim.width_in}`,
          );
          assert.ok(
            totalH <= s.trim.height_in + 0.001 || totalH <= s.bleed?.height_in!,
            `${s.mail_type}/${s.variant} zone ${z.purpose} overflows height: ${totalH} vs ${s.trim.height_in}`,
          );
        }
      }
    }
  });

  it("findSpec returns null for unknown combos", () => {
    assert.equal(findSpec("postcard", "9999"), null);
    assert.equal(findSpec("nope", "4x6"), null);
  });

  it("findSpec returns the right spec for known combos", () => {
    const s = findSpec("postcard", "4x6");
    assert.ok(s);
    assert.equal(s?.title, "Postcard 4×6");
  });

  it("variantsFor returns variants in declared order", () => {
    const postcards = variantsFor("postcard");
    assert.deepEqual(
      postcards.map((s) => s.variant),
      ["4x6", "6x9", "6x11"],
    );
  });

  it("listMailTypes returns the 6 supported mail types", () => {
    assert.deepEqual(listMailTypes(), [
      "postcard",
      "letter",
      "self_mailer",
      "check",
      "buckslip",
      "card",
    ]);
  });

  it("the postcard 4x6 back ink-free zone is exactly 3.2835×2.375 (bug-driver)", () => {
    const s = findSpec("postcard", "4x6")!;
    const back = s.surfaces.find((x) => x.name === "back")!;
    const zone = back.no_print_zones[0];
    assert.equal(zone.width_in, 3.2835);
    assert.equal(zone.height_in, 2.375);
    assert.equal(zone.anchor, "bottom_right");
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test
```

Expected: 10 new tests pass.

---

## Subsystem 2: PDF asset bundling + loader

### Task 2.1: Build step that copies PDFs

**Files:**
- Create: `scripts/copy-spec-pdfs.mjs`
- Modify: `package.json` (build script)

- [ ] **Step 1: Write the copy script**

```js
// scripts/copy-spec-pdfs.mjs
#!/usr/bin/env node
/**
 * Build helper. Copies specs/pdfs/ into build/specs/pdfs/ so the bundled
 * PDF templates ship in the npm artifact (`files: ["build"]` in package.json
 * already covers anything under build/).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = path.join(repoRoot, "specs/pdfs");
const dst = path.join(repoRoot, "build/specs/pdfs");

if (!fs.existsSync(src)) {
  console.error(`copy-spec-pdfs: source dir missing — ${src}`);
  console.error("Run `node scripts/download-spec-pdfs.mjs` first.");
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
const entries = fs.readdirSync(src);
let copied = 0;
for (const entry of entries) {
  if (!entry.endsWith(".pdf")) continue;
  fs.copyFileSync(path.join(src, entry), path.join(dst, entry));
  copied++;
}
console.log(`copy-spec-pdfs: ${copied} PDFs → build/specs/pdfs/`);
```

- [ ] **Step 2: Update build script in package.json**

Change the `build` line:

```json
"build": "tsc && chmod 755 build/index.js && node scripts/copy-spec-pdfs.mjs",
```

- [ ] **Step 3: Run build, verify PDFs land**

```bash
npm run build
ls build/specs/pdfs/
```

Expected: 12 PDF files visible in `build/specs/pdfs/`.

### Task 2.2: PDF loader with caching

**Files:**
- Create: `src/specs/pdf-loader.ts`

- [ ] **Step 1: Implement**

```ts
// src/specs/pdf-loader.ts
/**
 * Reads bundled PDF templates from build/specs/pdfs/. Caches in-process so
 * each PDF is read once per server lifetime.
 *
 * URI scheme: `lob://specs/{mail_type}/{variant}.pdf` maps to
 * `build/specs/pdfs/{mail_type}-{variant}.pdf` with hyphens (not slashes)
 * separating components — Node's filesystem can't have slashes in filenames.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR = path.resolve(__dirname, "../../build/specs/pdfs");

const cache = new Map<string, Buffer>();

export interface LoadedPdf {
  bytes: Buffer;
  base64: string;
  mimeType: "application/pdf";
}

export function pdfFilenameFor(mailType: string, variant: string): string {
  // Replace dots with underscores to keep filenames sane (8.5x14 → 8_5x14).
  const v = variant.replace(/\./g, "_");
  return `${mailType}-${v}.pdf`;
}

export function loadPdfTemplate(mailType: string, variant: string): LoadedPdf | null {
  const filename = pdfFilenameFor(mailType, variant);
  const cached = cache.get(filename);
  if (cached) {
    return { bytes: cached, base64: cached.toString("base64"), mimeType: "application/pdf" };
  }
  const filepath = path.join(PDF_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  const bytes = fs.readFileSync(filepath);
  cache.set(filename, bytes);
  return { bytes, base64: bytes.toString("base64"), mimeType: "application/pdf" };
}

/** Lists pdf files actually present on disk. Used by the resource lister. */
export function listAvailablePdfs(): string[] {
  if (!fs.existsSync(PDF_DIR)) return [];
  return fs.readdirSync(PDF_DIR).filter((f) => f.endsWith(".pdf"));
}
```

Filename mapping: when the URI is `lob://specs/letter/legal_8.5x14.pdf`, the resource template parses `variant=legal_8.5x14` and the loader's `pdfFilenameFor("letter", "legal_8.5x14")` produces `letter-legal_8_5x14.pdf` on disk (dots → underscores). The download script writes to that same converted filename so URI parsing and file lookup stay aligned. Spot-check by listing both:

```bash
ls specs/pdfs/letter-legal_8_5x14.pdf   # written by download script
```

The bundled file path matches what `loadPdfTemplate` expects.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

---

## Subsystem 3: Register MCP resources + fallback tool

### Task 3.1: Resource + tool registration

**Files:**
- Create: `src/specs/register.ts`
- Modify: `src/tools/register.ts`

- [ ] **Step 1: Implement**

```ts
// src/specs/register.ts
/**
 * Registers design-spec resources and the fallback tool with the MCP server.
 *
 * Two resource flavors:
 *   • JSON spec at lob://specs/{mail_type}/{variant}.json — content from the manifest.
 *   • PDF template at lob://specs/{mail_type}/{variant}.pdf — bundled blob.
 *
 * Plus a single tool, lob_design_specs_get, that returns the JSON inline for
 * hosts that under-implement resources.
 *
 * The resource template uses RFC 6570 syntax. The list callback enumerates
 * every (mail_type, variant) so hosts can populate a picker.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSpec, SPEC_MANIFEST } from "./manifest.js";
import { loadPdfTemplate } from "./pdf-loader.js";
import { ToolAnnotationPresets, registerTool } from "../tools/helpers.js";

export function registerSpecsResources(server: McpServer): void {
  // ── JSON spec — parameterized resource ───────────────────────────────────
  server.registerResource(
    "lob_design_specs_json",
    new ResourceTemplate("lob://specs/{mail_type}/{variant}.json", {
      list: async () => ({
        resources: SPEC_MANIFEST.map((s) => ({
          uri: `lob://specs/${s.mail_type}/${s.variant}.json`,
          name: `${s.title} — JSON spec`,
          description: s.human_readable_summary,
          mimeType: "application/json",
          annotations: { audience: ["assistant", "user"], priority: 0.9 },
        })),
      }),
    }),
    {
      title: "Lob design specifications (JSON)",
      description:
        "Structured dimensions, bleed, safe area, no-print zones, and file-format requirements for every supported (mail_type, variant) combination. Use this before designing a mail piece so artwork respects Lob's auto-stamped address blocks.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const mailType = String(params.mail_type);
      const variant = String(params.variant);
      const spec = findSpec(mailType, variant);
      if (!spec) {
        throw new Error(
          `No spec for ${mailType}/${variant}. Available: ${SPEC_MANIFEST.map(
            (s) => `${s.mail_type}/${s.variant}`,
          ).join(", ")}`,
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(spec, null, 2),
          },
        ],
      };
    },
  );

  // ── PDF templates — one static resource per bundled file ─────────────────
  for (const spec of SPEC_MANIFEST) {
    if (!spec.references.mcp_resource_uri) continue;
    const pdfUri = spec.references.mcp_resource_uri;
    server.registerResource(
      `lob_design_specs_pdf_${spec.mail_type}_${spec.variant}`.replace(
        /[^a-zA-Z0-9_]/g,
        "_",
      ),
      pdfUri,
      {
        title: `${spec.title} — Lob template PDF`,
        description: `Lob's official template PDF showing trim, bleed, and safe-area boundaries. Source: ${spec.references.lob_source_url}`,
        mimeType: "application/pdf",
        annotations: { audience: ["user", "assistant"], priority: 0.7 },
      },
      async (uri) => {
        const pdf = loadPdfTemplate(spec.mail_type, spec.variant);
        if (!pdf) {
          throw new Error(
            `PDF for ${spec.mail_type}/${spec.variant} not found in build/specs/pdfs/. Did you run \`node scripts/download-spec-pdfs.mjs && npm run build\`?`,
          );
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: pdf.mimeType,
              blob: pdf.base64,
            },
          ],
        };
      },
    );
  }

  // ── Fallback tool — same JSON, model-driven access ───────────────────────
  registerTool(server, {
    name: "lob_design_specs_get",
    annotations: {
      title: "Get Lob design spec",
      ...ToolAnnotationPresets.read,
    },
    description:
      "Return the design specification (dimensions, bleed, safe area, no-print zones, file requirements) for a Lob mail-piece variant. Call this BEFORE generating artwork so the design respects Lob's auto-stamped address blocks. Same data is also available as MCP resources at lob://specs/{mail_type}/{variant}.json.",
    inputSchema: {
      mail_type: z
        .enum(["postcard", "letter", "self_mailer", "check", "buckslip", "card"])
        .describe("Mail-piece category."),
      variant: z
        .string()
        .describe(
          "Variant identifier within the mail_type. For postcards: 4x6, 6x9, 6x11. " +
            "For letters: standard_no10, flat_9x12, legal_8.5x14, custom_envelope. " +
            "For self-mailers: 6x18_bifold, 11x9_bifold. " +
            "For checks: standard. For buckslip / card: standard.",
        ),
    },
    handler: async ({ mail_type, variant }) => {
      const spec = findSpec(mail_type, variant);
      if (!spec) {
        const available = SPEC_MANIFEST.filter((s) => s.mail_type === mail_type)
          .map((s) => s.variant)
          .join(", ");
        throw new Error(
          `No spec for ${mail_type}/${variant}. Available variants for ${mail_type}: ${available || "(none)"}.`,
        );
      }
      return spec;
    },
  });
}
```

- [ ] **Step 2: Wire into the global register**

In `src/tools/register.ts`, add:

```ts
import { registerSpecsResources } from "../specs/register.js";

// at the bottom of registerAllTools(...):
registerSpecsResources(server);
```

- [ ] **Step 3: Declare resources capability in index.ts**

In `src/index.ts`, the `new McpServer(...)` call needs the resources capability. Find:

```ts
const server = new McpServer(
  { name: "lob-mcp", version: SERVER_VERSION },
  { instructions: ... },
);
```

Update the second argument:

```ts
const server = new McpServer(
  { name: "lob-mcp", version: SERVER_VERSION },
  {
    capabilities: { resources: { listChanged: false } },
    instructions: ...,
  },
);
```

The McpServer constructor accepts capabilities at creation; if the SDK expects them elsewhere, surface that during the build.

- [ ] **Step 4: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: clean.

### Task 3.2: Resource registration tests

**Files:**
- Create: `tests/unit/specs-resources.test.ts`

- [ ] **Step 1: Implement**

```ts
// tests/unit/specs-resources.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSpecsResources } from "../../src/specs/register.js";

describe("registerSpecsResources", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSpecsResources(server);
    // No assertion needed beyond not throwing — server internals are private.
  });

  it("the fallback tool produces the right JSON for postcard 4x6", async () => {
    // Direct manifest lookup proves the data is wired correctly; the SDK's
    // tool-call path is exercised by the integration smoke.
    const { findSpec } = await import("../../src/specs/manifest.js");
    const spec = findSpec("postcard", "4x6");
    assert.ok(spec);
    const back = spec!.surfaces.find((s) => s.name === "back");
    assert.ok(back);
    assert.equal(back!.no_print_zones[0].purpose, "address_block_and_indicia");
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test
```

Expected: tests pass.

---

## Subsystem 4: Inline spec into preview responses

### Task 4.1: Thread spec into postcard preview

**Files:**
- Modify: `src/tools/postcards.ts`

- [ ] **Step 1: Wrap renderPreview to attach the design_spec**

Find the existing `renderPreview` closure inside `registerPostcardTools`:

```ts
renderPreview: async (payload) => {
  return lob.request({
    method: "POST",
    path: "/resource_proofs",
    body: {
      resource_type: "postcard",
      resource_parameters: stripCommitOnly(payload),
    },
    keyMode: "test",
  });
},
```

Replace with:

```ts
renderPreview: async (payload) => {
  const proof = (await lob.request({
    method: "POST",
    path: "/resource_proofs",
    body: {
      resource_type: "postcard",
      resource_parameters: stripCommitOnly(payload),
    },
    keyMode: "test",
  })) as Record<string, unknown>;
  const variant = (payload.size as string | undefined) ?? "4x6";
  const spec = findSpec("postcard", variant);
  return { ...proof, design_spec: spec ?? null };
},
```

Add the import at the top:

```ts
import { findSpec } from "../specs/manifest.js";
```

- [ ] **Step 2: Repeat for letters, self-mailers, checks, buckslip-orders, card-orders**

For each existing billable preview, attach the right spec:

- **letters** — variant comes from a custom env or falls back to `standard_no10`. Choose:
  ```ts
  const variant = (payload as Record<string, unknown>).custom_envelope
    ? "custom_envelope"
    : "standard_no10";
  const spec = findSpec("letter", variant);
  ```
- **self-mailers** — variant from `payload.size` (`6x18_bifold` default).
- **checks** — `findSpec("check", "standard")`.
- **buckslip orders** — `findSpec("buckslip", "standard")`.
- **card orders** — `findSpec("card", "standard")`.

Each `renderPreview` returns `{ ...originalResponse, design_spec }`.

- [ ] **Step 3: Smoke**

```bash
npm run build
node tests/integration.mjs 2>&1 | grep -E "design_spec|tools|preview"
```

We don't have a check yet for `design_spec` — extend the integration script next.

### Task 4.2: Extend integration smoke with design_spec assertion

**Files:**
- Modify: `tests/integration.mjs`

- [ ] **Step 1: Add design-spec checks**

After the `preview returns Lob thumbnails` block, add:

```js
const ds = previewBody?.design_spec;
if (ds && ds.mail_type === "postcard" && ds.variant === "4x6") {
  pass("preview includes design_spec for postcard 4x6");
} else {
  fail("preview design_spec", `missing or wrong shape: ${JSON.stringify(ds).slice(0, 200)}`);
}
const backZone = ds?.surfaces?.find?.((s) => s.name === "back")?.no_print_zones?.[0];
if (backZone?.width_in === 3.2835 && backZone?.height_in === 2.375) {
  pass("design_spec back ink-free zone is 3.2835×2.375");
} else {
  fail("design_spec back zone", `unexpected shape: ${JSON.stringify(backZone)}`);
}
```

After tools/list, also verify the `lob_design_specs_get` tool exists:

```js
if (list.tools.find((t) => t.name === "lob_design_specs_get")) {
  pass("lob_design_specs_get tool registered");
} else {
  fail("lob_design_specs_get", "tool missing from tools/list");
}
```

Add a direct invocation:

```js
const specRes = await callTool(client, "lob_design_specs_get", {
  mail_type: "postcard",
  variant: "4x6",
});
if (specRes.error) {
  fail("lob_design_specs_get", specRes.error);
} else if (specRes.result?.surfaces?.[1]?.no_print_zones?.[0]?.width_in === 3.2835) {
  pass("lob_design_specs_get returns correct postcard 4x6 spec");
} else {
  fail("lob_design_specs_get", `unexpected shape: ${JSON.stringify(specRes.result).slice(0, 300)}`);
}
```

Update the `tools/list returns N tools` expectation: was 76, now **77**.

- [ ] **Step 2: Run**

```bash
node tests/integration.mjs
```

Expected: 14+/14+ checks pass (the existing 11 plus the new 3-4 design-spec checks).

### Task 4.3: Resources/list smoke

The integration script also exercises the resources surface to confirm the registration code is wired.

- [ ] **Step 1: Add resource listing block**

At the end of `main()` in `tests/integration.mjs`, before `await client.close()`:

```js
const resourceList = await client.listResources();
const jsonResources = resourceList.resources.filter((r) =>
  r.uri.endsWith(".json"),
);
const pdfResources = resourceList.resources.filter((r) =>
  r.uri.endsWith(".pdf"),
);
if (jsonResources.length === 12) pass(`resources/list — 12 JSON specs`);
else fail("json resources count", `expected 12, got ${jsonResources.length}`);
if (pdfResources.length >= 11) pass(`resources/list — ${pdfResources.length} PDF templates`);
else fail("pdf resources count", `expected 11+, got ${pdfResources.length}`);

const readJson = await client.readResource({
  uri: "lob://specs/postcard/4x6.json",
});
const parsed = JSON.parse(readJson.contents[0].text);
if (parsed.surfaces?.[1]?.no_print_zones?.[0]?.width_in === 3.2835) {
  pass("resources/read JSON shape correct");
} else {
  fail("resources/read JSON", JSON.stringify(parsed).slice(0, 200));
}

const readPdf = await client.readResource({
  uri: "lob://specs/postcard/4x6.pdf",
});
if (readPdf.contents[0].mimeType === "application/pdf" && readPdf.contents[0].blob?.length > 100) {
  pass(`resources/read PDF returns ${readPdf.contents[0].blob.length}-char base64 blob`);
} else {
  fail("resources/read PDF", JSON.stringify(readPdf).slice(0, 200));
}
```

- [ ] **Step 2: Run**

```bash
node tests/integration.mjs
```

Expected: all green, including 4 new resource-related checks.

---

## Subsystem 5: Documentation

### Task 5.1: README — add Design Specs section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Insert new section after the Safety section**

Find the line `## Tool reference` and insert before it:

```markdown
## Design specifications

lob-mcp exposes Lob's official mail-piece design specifications so AI design tools can produce print-correct artwork. Two access surfaces:

### MCP resources (recommended)

Hosts that support MCP resources (Claude Desktop, MCP Inspector, most modern agent frameworks) can browse and attach specs to chat context:

- `lob://specs/{mail_type}/{variant}.json` — structured JSON: dimensions, bleed, safe area, no-print zones, file-format requirements, and Lob's official PDF reference URL.
- `lob://specs/{mail_type}/{variant}.pdf` — Lob's official template PDF, served as a base64 blob bundled with the package.

`resources/list` returns 12 JSON specs and 11 PDF templates. Each is annotated with `audience: ["user", "assistant"]` so it shows up in pickers.

### Tool fallback

For hosts without resource support, call `lob_design_specs_get(mail_type, variant)` — same JSON, returned inline.

### Inline in preview responses

Every `*_preview` tool response now includes a `design_spec` field with the relevant spec for the variant being previewed. The model has the no-print-zone coordinates in scope when reviewing a Lob proof, so it can self-audit before committing.

### Supported variants

| `mail_type` | `variant` |
|---|---|
| `postcard` | `4x6`, `6x9`, `6x11` |
| `letter` | `standard_no10`, `flat_9x12`, `legal_8_5x14`, `custom_envelope` |
| `self_mailer` | `6x18_bifold`, `11x9_bifold` |
| `check` | `standard` |
| `buckslip` | `standard` |
| `card` | `standard` |

### Refreshing PDF templates

Maintainers can pull the latest PDFs from Lob's S3 with:

```bash
node scripts/download-spec-pdfs.mjs
```

Re-run `npm run build` to copy them into `build/specs/pdfs/`. Commit the refreshed PDFs to git.
```

- [ ] **Step 2: Update tool-count line**

Find `**76 tools** across 11 resource groups` and change to:

```markdown
**77 tools + 23 design-spec resources** across 12 resource groups
```

### Task 5.2: CHANGELOG — 1.1.0 entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Prepend the new entry**

Insert before the `## 1.0.0` line:

```markdown
## 1.1.0 — 2026-04-?? (Design specs release)

### Added

- 12 design-spec JSON resources at `lob://specs/{mail_type}/{variant}.json` covering postcards (4x6, 6x9, 6x11), letters (standard_no10, flat_9x12, legal_8_5x14, custom_envelope), self-mailers (6x18_bifold, 11x9_bifold), checks, buckslips, and cards. Each spec includes dimensions, bleed, safe area, no-print zones (with anchor + offset semantics), file-format requirements, and Lob's source URL.
- 11 bundled PDF template resources at `lob://specs/{mail_type}/{variant}.pdf`, served as base64 blobs (no external fetch). Refreshed from Lob's S3 via `scripts/download-spec-pdfs.mjs`.
- `lob_design_specs_get(mail_type, variant)` fallback tool — returns the same JSON inline. For hosts that under-implement MCP resources.
- Every `*_preview` tool response now includes a `design_spec` field with the spec for the variant being previewed.
- Resources capability declared on the McpServer.

### Future work

- A `lob_design_lint` tool that fetches a candidate design and validates dimensions, asset reachability, font embedding, and no-print-zone overlap.
- MCP prompts for guided design briefs (parameterized).
- Spec for the cards standalone PDF template once Lob publishes one.

### Background

The 1.0 hardening release verified the preview/commit + dual-key + idempotency path end-to-end with a real test postcard. That postcard's back-side body text was clipped by Lob's auto-stamped address block — the model had no way to know about the 3.2835″×2.375″ ink-free zone. 1.1 makes the spec discoverable so this won't happen again.
```

### Task 5.3: CLAUDE.md — bump tool count + document specs subsystem

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update top-line tool count**

Find `**76 tools across 11 resource groups**` and change to `**77 tools + 23 design-spec resources across 12 resource groups**`.

- [ ] **Step 2: Update smoke test target in Commands section**

Change `must return 76` → `must return 77`.

- [ ] **Step 3: Add specs subsystem to Architecture section**

After the `src/safety/` block in the architecture tree, add:

```
├── specs/
│   ├── manifest.ts              # source-of-truth: every (mail_type, variant) spec
│   ├── pdf-loader.ts            # loads bundled PDFs from build/specs/pdfs/
│   └── register.ts              # registers JSON + PDF resources + fallback tool
```

Add a "Patterns that matter" bullet:

```markdown
- **Design specs are exposed three ways**, all reading from `src/specs/manifest.ts`: (a) JSON resource at `lob://specs/{mail_type}/{variant}.json`, (b) PDF resource at `lob://specs/{mail_type}/{variant}.pdf` (base64 blob from build/specs/pdfs/), and (c) a fallback `lob_design_specs_get` tool. Every `*_preview` response also surfaces the relevant spec inline. When adding a new variant: add to the manifest, drop a PDF in `specs/pdfs/`, run `npm run build` (which copies to `build/specs/pdfs/`).
```

### Task 5.4: package.json version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump**

```json
"version": "1.1.0",
```

Update description:

```json
"description": "MCP server for the Lob.com API — 77 tools + 23 design-spec resources for safe, print-correct LLM-driven physical mail.",
```

### Task 5.5: src/version.ts version bump

**Files:**
- Modify: `src/version.ts`

- [ ] **Step 1: Bump**

```ts
export const SERVER_VERSION = "1.1.0";
```

---

## Subsystem 6: Final smoke + commit + publish

### Task 6.1: Full clean run

- [ ] **Step 1: Clean rebuild**

```bash
rm -rf build
npm run typecheck
npm run build
```

Expected: clean output. `build/specs/pdfs/` populated with 12 PDFs.

- [ ] **Step 2: Unit tests**

```bash
npm test
```

Expected: all tests pass (47 from 1.0 + 10 manifest tests + 2 resource tests = 59 tests).

- [ ] **Step 3: tools/list smoke**

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | LOB_TEST_API_KEY=test_x node build/index.js 2>/dev/null \
  | tail -1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const r=JSON.parse(d).result.tools;console.log("tools:",r.length)})'
```

Expected: `tools: 77`.

- [ ] **Step 4: Integration smoke against Lob test API**

```bash
node tests/integration.mjs
```

Expected: all checks pass (existing 11 + ~6 new = 17+/17+).

- [ ] **Step 5: Inspector spot-check**

```bash
npm run inspector
```

In the Inspector UI, confirm:
1. Resources tab shows the 23 entries (12 JSON + 11 PDF).
2. Clicking a JSON resource (`lob://specs/postcard/4x6.json`) renders the structured JSON.
3. Clicking a PDF resource (`lob://specs/postcard/4x6.pdf`) renders the PDF inline (or downloads).
4. Calling `lob_design_specs_get` with `mail_type="postcard", variant="4x6"` returns the JSON.
5. Calling `lob_postcards_preview` returns a response that includes `design_spec.surfaces[1].no_print_zones[0].width_in === 3.2835`.

### Task 6.2: Commit, merge, push, tag, publish

- [ ] **Step 1: Stage**

```bash
git checkout -b feat/1.1-design-specs
git add CHANGELOG.md CLAUDE.md README.md package.json package-lock.json src/ docs/ specs/ scripts/
git status
```

Verify staged set excludes `tests/` (gitignored), `.env.test*`, `node_modules/`, `build/`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 1.1 design specs — JSON+PDF resources, fallback tool, inline-into-preview

Adds Lob's official design specifications as MCP resources so AI design tools
can produce print-correct artwork that respects Lob's auto-stamped address
blocks (the bug that clipped the 1.0 verification postcard's back-side body).

- 12 JSON spec resources at lob://specs/{mail_type}/{variant}.json with
  dimensions, bleed, safe area, no-print zones, file-format requirements.
- 11 bundled Lob PDF templates as base64 blob resources at
  lob://specs/{mail_type}/{variant}.pdf — refreshed via
  scripts/download-spec-pdfs.mjs.
- lob_design_specs_get(mail_type, variant) fallback tool for hosts that
  under-implement resources.
- Every *_preview response now includes design_spec inline so the model has
  no-print-zone coordinates when reviewing the proof.
- Resources capability declared on McpServer.

Tool count: 76 → 77. Resources: 0 → 23. Bumped to 1.1.0 (additive,
non-breaking).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Merge to main + push + tag (per CLAUDE.local.md workflow)**

```bash
git checkout main
git merge --ff-only feat/1.1-design-specs
git push origin main
git tag v1.1.0
git push --tags
git branch -d feat/1.1-design-specs
```

- [ ] **Step 4: Publish to npm**

```bash
npm publish --dry-run
npm publish
```

Confirm output shows `lob-mcp@1.1.0` published.

- [ ] **Step 5: GitHub release**

```bash
gh release create v1.1.0 --title "v1.1.0 — Design specs release" --notes-file CHANGELOG.md
```

---

## Definition of Done

- One commit at HEAD on `main` with the full 1.1 diff.
- `npm run typecheck && npm run build && npm test` clean.
- tools/list returns 77.
- resources/list returns 23 entries (12 JSON + 11 PDF).
- Integration smoke (`tests/integration.mjs`) passes ≥17 checks.
- Inspector spot-check confirms all 5 design-spec interactions work.
- README, CHANGELOG, CLAUDE.md updated.
- npm published, tag pushed, GitHub release created.
- Future-work items (design lint, prompts) called out in CHANGELOG.
