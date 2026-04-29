/**
 * Stable canonical JSON + SHA-256 hash for binding a preview to its commit.
 *
 * Keys ignored when hashing — these may legitimately differ between preview and
 * commit:
 *   • idempotency_key — generated per call.
 *   • metadata        — observational tags, not part of the mail-piece content.
 *   • confirmation_token — present only on commit.
 *
 * Object keys are sorted recursively; undefined values dropped; arrays preserved
 * in order.
 */
import { createHash } from "node:crypto";

const IGNORED_KEYS = new Set(["idempotency_key", "metadata", "confirmation_token"]);

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).filter((k) => !IGNORED_KEYS.has(k)).sort()) {
    if (obj[k] === undefined) continue;
    out[k] = canonical(obj[k]);
  }
  return out;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}
