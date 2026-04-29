#!/usr/bin/env node
/**
 * Build helper. Copies specs/pdfs/ → build/specs/pdfs/ so the bundled PDF
 * templates ship in the npm artifact (`files: ["build"]` in package.json
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
