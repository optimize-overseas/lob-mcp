#!/usr/bin/env node
/**
 * One-shot: download Lob's official template PDFs into specs/pdfs/.
 *
 * Maintainer runs this once; PDFs are committed to git and packed in npm.
 * Re-run to refresh if Lob updates a template.
 *
 * Filenames follow `{mail_type}-{variant}.pdf` where dots in variant strings
 * are replaced with underscores. The pdf-loader uses the same mapping so the
 * URI -> file path conversion stays aligned.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "specs/pdfs");
fs.mkdirSync(outDir, { recursive: true });

const TEMPLATES = [
  ["postcard-4x6.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/4x6_postcard.pdf"],
  ["postcard-6x9.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x9_postcard.pdf"],
  ["postcard-6x11.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/postcards/6x11_postcard.pdf"],
  ["letter-standard_no10.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_template_updated+4_25.pdf"],
  ["letter-flat_9x12.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/letter_flat_template_updated+4_25.pdf"],
  ["letter-legal_8_5x14.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/Legal_Letter_updated_4_25.pdf"],
  ["letter-custom_envelope.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/no10_env_template.pdf"],
  ["self_mailer-6x18_bifold.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/6x18_sfm_bifold_template.pdf"],
  ["self_mailer-11x9_bifold.pdf", "https://s3.us-west-2.amazonaws.com/public.lob.com/assets/templates/self_mailers/11x9_sfm_bifold_template.pdf"],
  ["check-standard.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/check_bottom_template.pdf"],
  ["buckslip-standard.pdf", "https://s3-us-west-2.amazonaws.com/public.lob.com/assets/templates/buckslip_template.pdf"],
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
