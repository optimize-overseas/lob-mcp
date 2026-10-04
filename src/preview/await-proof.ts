/**
 * Wait for a resource proof to finish rendering before a preview returns it.
 *
 * `POST /resource_proofs` answers at once with `status: "processing"`,
 * `url: null` and no thumbnails; Lob renders the PDF a few seconds later.
 * A preview that returned that first answer showed the model no proof at
 * all, and calling the preview again only created another unrendered proof.
 * So the `*_preview` tools poll `GET /resource_proofs/{id}` until the status
 * leaves "processing", bounded by `LOB_PROOF_WAIT_MS`.
 *
 * Proofs are a test-key artifact, never billed, so polling costs nothing.
 * A poll that fails is not fatal: the proof was created and the preview's
 * token is still worth issuing. A timeout, a 5xx, a 408 or a 429 is retried on
 * the next poll, and so is an answer that is not this proof; any other 4xx will
 * not change on retry, so it ends the wait at once. A proof that
 * is not rendered when the wait ends comes back marked `render_pending` with
 * the tool that fetches it later. The bound is checked between polls, so a
 * poll already in flight at the deadline may run to LOB_REQUEST_TIMEOUT_MS.
 */
import type { LobClient } from "../lob/client.js";
import { LobApiError } from "../lob/errors.js";

const POLL_INTERVAL_MS = 1_000;

export interface AwaitProofOptions {
  /** Total time to wait for rendering. Defaults to `lob.env.proofWaitMs`. */
  waitMs?: number;
  /** Delay between polls. */
  intervalMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. */
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 4xx statuses that are worth retrying: request timeout and rate limiting. */
const TRANSIENT_CLIENT_STATUSES = new Set([408, 429]);

function isRendering(proof: Record<string, unknown>): boolean {
  return proof.status === "processing";
}

function isProofObject(value: unknown, id: string): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).id === id
  );
}

function endsTheWait(err: unknown): err is LobApiError {
  return (
    err instanceof LobApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    !TRANSIENT_CLIENT_STATUSES.has(err.status)
  );
}

function formatWait(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

function pending(proof: Record<string, unknown>, id: string, why: string): Record<string, unknown> {
  return {
    ...proof,
    render_pending: true,
    render_note:
      `${why} Fetch it later with lob_resource_proofs_get (id ${id}) to get the url; ` +
      "calling the preview again creates a new proof that starts rendering from scratch.",
  };
}

function settled(proof: Record<string, unknown>): Record<string, unknown> {
  if (proof.status === "completed" || proof.url) return proof;
  return {
    ...proof,
    render_note: `Lob reports this proof as '${String(proof.status)}' with no url; see its errors.`,
  };
}

/** Create a proof with `POST /resource_proofs` and return it once rendered. */
export async function createRenderedProof(
  lob: Pick<LobClient, "request" | "env">,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const proof = await lob.request({
    method: "POST",
    path: "/resource_proofs",
    body,
    keyMode: "test",
  });
  // Not a proof object: hand back exactly what Lob sent, as before 1.5.3.
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
    return proof as Record<string, unknown>;
  }
  return awaitRenderedProof(lob, proof as Record<string, unknown>);
}

export async function awaitRenderedProof(
  lob: Pick<LobClient, "request" | "env">,
  proof: Record<string, unknown>,
  opts: AwaitProofOptions = {},
): Promise<Record<string, unknown>> {
  if (!isRendering(proof)) return settled(proof);
  const id = proof.id;
  if (typeof id !== "string" || id === "") return proof;

  const waitMs = opts.waitMs ?? lob.env.proofWaitMs;
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  if (waitMs <= 0) {
    return pending(proof, id, "This server does not wait for proofs to render (LOB_PROOF_WAIT_MS=0).");
  }
  const deadline = now() + waitMs;

  let latest = proof;
  while (now() < deadline) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
    let answer: unknown;
    try {
      answer = await lob.request({
        method: "GET",
        path: `/resource_proofs/${id}`,
        keyMode: "test",
      });
    } catch (err) {
      if (endsTheWait(err)) {
        return pending(latest, id, `Checking on this proof failed: ${err.message.replace(/\.$/, "")}.`);
      }
      continue;
    }
    if (!isProofObject(answer, id)) continue;
    latest = answer;
    if (!isRendering(latest)) return settled(latest);
  }

  return pending(
    latest,
    id,
    `Lob had not finished rendering this proof after ${formatWait(waitMs)}.`,
  );
}
