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
 * token is still worth issuing. A timeout or 5xx is retried on the next poll;
 * a 4xx will not change on retry, so it ends the wait at once. A proof that
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

function isRendering(proof: Record<string, unknown>): boolean {
  return proof.status === "processing";
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
  const proof = (await lob.request({
    method: "POST",
    path: "/resource_proofs",
    body,
    keyMode: "test",
  })) as Record<string, unknown>;
  return awaitRenderedProof(lob, proof);
}

export async function awaitRenderedProof(
  lob: Pick<LobClient, "request" | "env">,
  proof: Record<string, unknown>,
  opts: AwaitProofOptions = {},
): Promise<Record<string, unknown>> {
  const id = proof.id;
  if (!isRendering(proof) || typeof id !== "string" || id === "") return proof;

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
    try {
      latest = (await lob.request({
        method: "GET",
        path: `/resource_proofs/${id}`,
        keyMode: "test",
      })) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof LobApiError && err.status >= 400 && err.status < 500) {
        return pending(latest, id, `Checking on this proof failed: ${err.message}.`);
      }
      continue;
    }
    if (!isRendering(latest)) return settled(latest);
  }

  return pending(
    latest,
    id,
    `Lob had not finished rendering this proof after ${Math.round(waitMs / 1000)} s.`,
  );
}
