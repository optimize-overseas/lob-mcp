/**
 * Pluggable token store interface + an in-process default implementation.
 *
 * The interface is shaped so a Redis or Firestore backend could be dropped in
 * later for multi-instance deployments. Single-process Node is single-threaded
 * for JS, so InMemoryTokenStore.consume() is safe — Map.delete is atomic vs.
 * other JS scheduling.
 */
import type { PreviewRecord } from "./preview-record.js";

export interface TokenStore {
  put(record: PreviewRecord): void;
  get(token: string): PreviewRecord | null;
  /** Atomic get + delete. Returns null if missing or expired. */
  consume(token: string): PreviewRecord | null;
  /** Remove expired records. Safe to call on an interval. */
  cleanup(): void;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly records = new Map<string, PreviewRecord>();

  put(record: PreviewRecord): void {
    this.records.set(record.token, record);
  }

  get(token: string): PreviewRecord | null {
    const r = this.records.get(token);
    if (!r) return null;
    if (r.expiresAt <= Date.now()) {
      this.records.delete(token);
      return null;
    }
    return r;
  }

  consume(token: string): PreviewRecord | null {
    const r = this.records.get(token);
    if (!r) return null;
    if (r.expiresAt <= Date.now()) {
      this.records.delete(token);
      return null;
    }
    this.records.delete(token);
    return r;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [t, r] of this.records.entries()) {
      if (r.expiresAt <= now) this.records.delete(t);
    }
  }
}
