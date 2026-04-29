/**
 * Reads bundled PDF templates from build/specs/pdfs/. Caches in-process so
 * each PDF is read once per server lifetime.
 *
 * URI scheme: `lob://specs/{mail_type}/{variant}.pdf` maps to
 * `build/specs/pdfs/{mail_type}-{variant}.pdf` with hyphens (not slashes)
 * separating components, and dots in the variant string converted to
 * underscores so the filename is filesystem-safe.
 *
 * Example: lob://specs/letter/legal_8.5x14.pdf → build/specs/pdfs/letter-legal_8_5x14.pdf
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
  const v = variant.replace(/\./g, "_");
  return `${mailType}-${v}.pdf`;
}

export function loadPdfTemplate(mailType: string, variant: string): LoadedPdf | null {
  const filename = pdfFilenameFor(mailType, variant);
  const cached = cache.get(filename);
  if (cached) {
    return {
      bytes: cached,
      base64: cached.toString("base64"),
      mimeType: "application/pdf",
    };
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
