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
 *
 * Sources: Lob's published help-center articles under
 * https://help.lob.com/print-and-mail/designing-mail-creatives/.
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
            notes:
              "Sender window — optional, reveals return address area on the letter or insert.",
          },
        ],
      },
    ],
    file_requirements: { ...DEFAULT_FILE_REQUIREMENTS },
    notes: [
      "AI/INDD/PSD accepted in addition to PDF.",
      "Custom envelopes cannot be combined with affixed-card-insert letters.",
      "Material: embossed 24# white wove with vertical grooves and blue security tint.",
    ],
    references: {
      mcp_resource_uri: "lob://specs/letter/custom_envelope.pdf",
      lob_source_url:
        "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/no10_env_template.pdf",
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
      "Sub-artifact templates (not surfaced as separate resources): check_attachment_template.pdf for the optional attachment.",
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
