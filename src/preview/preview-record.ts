/**
 * Stored record bound to a confirmation_token. The TokenStore holds these.
 */
export interface PreviewRecord {
  /** UUIDv4 returned by `*_preview` and required by `*_create` in live mode. */
  token: string;
  /** Fully-qualified base name, e.g. "lob_postcards". For diagnostics + cross-tool guards. */
  toolName: string;
  /** SHA-256 hex digest of the canonicalized payload (excludes idempotency_key/metadata/token). */
  payloadHash: string;
  /** The validated payload that was previewed. Useful for diagnostics. */
  payload: unknown;
  /** Whatever the renderPreview hook returned (e.g. Lob proof URL or textual summary). */
  previewResponse: unknown;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. After this point, get/consume return null. */
  expiresAt: number;
}
