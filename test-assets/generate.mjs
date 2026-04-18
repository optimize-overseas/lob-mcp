#!/usr/bin/env node
/**
 * Generates the minimum-viable Lob-compatible PDFs needed by the verification
 * harness. Run: `node test-assets/generate.mjs` (requires pdf-lib devDependency).
 *
 * Each PDF is generated at the exact dimensions Lob's API enforces, in points
 * (1 inch = 72 points), with a small label for human readability.
 *
 * Outputs (all under this directory):
 *   postcard-4x6-creative.pdf   6.25" × 4.25"   → lob_creatives_create (resource_type: postcard, details.size: 4x6)
 *   buckslip.pdf                8.75" × 3.75"   → lob_buckslips_create
 *   card.pdf                    3.375" × 2.125" → lob_cards_create
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const P = 72; // points per inch

async function makePdf(label, widthInches, heightInches, outFile) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([widthInches * P, heightInches * P]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({
    x: 0, y: 0,
    width: widthInches * P,
    height: heightInches * P,
    color: rgb(0.95, 0.95, 0.95),
  });
  page.drawText(label, {
    x: 18,
    y: (heightInches * P) / 2 - 6,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  const bytes = await pdf.save();
  fs.writeFileSync(path.join(dir, outFile), bytes);
  console.log(`wrote ${outFile} — ${widthInches}"×${heightInches}" — ${bytes.length}B`);
}

await makePdf("lob-mcp harness · postcard creative (6.25×4.25)", 6.25, 4.25, "postcard-4x6-creative.pdf");
await makePdf("lob-mcp harness · buckslip (8.75×3.75)", 8.75, 3.75, "buckslip.pdf");
await makePdf("lob-mcp harness · card (3.375×2.125)", 3.375, 2.125, "card.pdf");
