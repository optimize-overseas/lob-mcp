/**
 * A preview waits for its proof to render.
 *
 * `POST /resource_proofs` answers with `status: "processing"` and `url: null`;
 * the rendered PDF appears a few seconds later. These tests pin that the
 * `*_preview` tools poll the proof until it leaves "processing", stop at the
 * `LOB_PROOF_WAIT_MS` bound with a `render_pending` marker, and survive a
 * failed poll.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { awaitRenderedProof } from "../../src/preview/await-proof.js";
import { LobApiError, LobTimeoutError } from "../../src/lob/errors.js";
import { LobClient } from "../../src/lob/client.js";
import { loadEnv } from "../../src/env.js";
import { InMemoryTokenStore } from "../../src/preview/token-store.js";
import { PieceCounter } from "../../src/safety/piece-counter.js";
import { registerPostcardTools } from "../../src/tools/postcards.js";

type Req = { method: string; path: string; keyMode?: string };

function fakeLob(answers: Array<unknown>, proofWaitMs = 30_000) {
  const calls: Req[] = [];
  const lob = {
    env: { proofWaitMs } as LobClient["env"],
    request: async (opts: Req) => {
      calls.push(opts);
      if (answers.length === 0) throw new Error("no more answers");
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  } as unknown as LobClient;
  return { lob, calls };
}

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const processing = { id: "res_prf_xxxxxxxxxxxx", status: "processing", url: null, thumbnails: [] };
const completed = {
  id: "res_prf_xxxxxxxxxxxx",
  status: "completed",
  url: "https://example.com/proof.pdf",
  thumbnails: [{ small: "s", medium: "m", large: "l" }],
};

test("a proof that is already rendered is returned without polling", async () => {
  const { lob, calls } = fakeLob([]);
  const out = await awaitRenderedProof(lob, completed, fakeClock());
  assert.equal(out, completed);
  assert.equal(calls.length, 0);
});

test("a processing proof is polled with GET on the test key until it renders", async () => {
  const { lob, calls } = fakeLob([processing, processing, completed]);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(out.status, "completed");
  assert.equal(out.url, "https://example.com/proof.pdf");
  assert.equal(out.render_pending, undefined);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.deepEqual(c, { method: "GET", path: "/resource_proofs/res_prf_xxxxxxxxxxxx", keyMode: "test" });
  }
});

test("a proof still processing at the bound comes back marked render_pending", async () => {
  const answers = Array.from({ length: 50 }, () => ({ ...processing }));
  const { lob, calls } = fakeLob(answers);
  const out = await awaitRenderedProof(lob, processing, { ...fakeClock(), waitMs: 5_000, intervalMs: 1_000 });
  assert.equal(out.status, "processing");
  assert.equal(out.render_pending, true);
  assert.match(String(out.render_note), /lob_resource_proofs_get/);
  assert.match(String(out.render_note), /res_prf_xxxxxxxxxxxx/);
  assert.equal(calls.length, 5);
});

test("a failed poll is retried, not thrown", async () => {
  const { lob, calls } = fakeLob([new Error("socket hang up"), completed]);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(out.status, "completed");
  assert.equal(calls.length, 2);
});

test("a wait of 0 returns at once, marked render_pending", async () => {
  const { lob, calls } = fakeLob([], 0);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(out.render_pending, true);
  assert.match(String(out.render_note), /LOB_PROOF_WAIT_MS=0/);
  assert.equal(calls.length, 0);
});

test("a terminal status with no url says so instead of looking like a missing proof", async () => {
  const failed = { id: "res_prf_xxxxxxxxxxxx", status: "failed", url: null };
  const { lob } = fakeLob([failed]);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(out.status, "failed");
  assert.match(String(out.render_note), /'failed' with no url/);
  assert.equal(out.render_pending, undefined);
});

test("a 4xx on a poll ends the wait at once instead of retrying to the bound", async () => {
  const notFound = new LobApiError({ status: 404, message: "proof not found" } as never);
  const { lob, calls } = fakeLob([notFound, completed]);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(calls.length, 1);
  assert.equal(out.render_pending, true);
  assert.match(String(out.render_note), /Checking on this proof failed/);
});

const apiError = (status: number) => new LobApiError({ status, message: `status ${status}.` } as never);

for (const [label, err] of [
  ["a 429", apiError(429)],
  ["a 408", apiError(408)],
  ["a 503", apiError(503)],
  ["a request timeout", new LobTimeoutError("/resource_proofs/res_prf_xxxxxxxxxxxx", 30_000)],
] as const) {
  test(`${label} on a poll is retried, not treated as the end`, async () => {
    const { lob, calls } = fakeLob([err, completed]);
    const out = await awaitRenderedProof(lob, processing, fakeClock());
    assert.equal(out.status, "completed");
    assert.equal(out.url, "https://example.com/proof.pdf");
    assert.equal(calls.length, 2);
  });
}

test("a poll answer that is not this proof is skipped, never thrown on or spread", async () => {
  const other = { ...completed, id: "res_prf_yyyyyyyyyyyy" };
  const { lob, calls } = fakeLob([undefined, "not json", null, ["x"], other, completed]);
  const out = await awaitRenderedProof(lob, processing, fakeClock());
  assert.equal(out.id, "res_prf_xxxxxxxxxxxx");
  assert.equal(out.status, "completed");
  assert.equal(calls.length, 6);
});

test("a proof that is already final without a url when created says so", async () => {
  const { lob, calls } = fakeLob([]);
  const out = await awaitRenderedProof(lob, { id: "res_prf_xxxxxxxxxxxx", status: "failed", url: null }, fakeClock());
  assert.match(String(out.render_note), /'failed' with no url/);
  assert.equal(calls.length, 0);
});

test("a sub-second bound is reported in ms, not as 0 s", async () => {
  const { lob } = fakeLob([{ ...processing }]);
  const out = await awaitRenderedProof(lob, processing, { ...fakeClock(), waitMs: 400 });
  assert.equal(out.render_pending, true);
  assert.match(String(out.render_note), /after 400 ms\./);
});

// --- LOB_PROOF_WAIT_MS ---------------------------------------------------

const ENV_KEYS = ["LOB_TEST_API_KEY", "LOB_PROOF_WAIT_MS"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = realFetch;
});

test("LOB_PROOF_WAIT_MS defaults to 30 s, accepts 0 and refuses a negative", () => {
  process.env.LOB_TEST_API_KEY = "test_x";
  delete process.env.LOB_PROOF_WAIT_MS;
  assert.equal(loadEnv().proofWaitMs, 30_000);
  process.env.LOB_PROOF_WAIT_MS = "0";
  assert.equal(loadEnv().proofWaitMs, 0);
  process.env.LOB_PROOF_WAIT_MS = "4500.7";
  assert.equal(loadEnv().proofWaitMs, 4500);
  process.env.LOB_PROOF_WAIT_MS = "-1";
  assert.throws(() => loadEnv(), /LOB_PROOF_WAIT_MS/);
  process.env.LOB_PROOF_WAIT_MS = "soon";
  assert.throws(() => loadEnv(), /LOB_PROOF_WAIT_MS/);
});

// --- wire-up: lob_postcards_preview returns the rendered proof ------------

test("lob_postcards_preview returns the rendered proof, not the first processing answer", async () => {
  process.env.LOB_TEST_API_KEY = "test_x";
  process.env.LOB_PROOF_WAIT_MS = "10000";
  const seen: string[] = [];
  const answers = [processing, processing, completed];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
    return new Response(JSON.stringify(answers.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const tools = new Map<string, (args: unknown, extra: unknown) => Promise<unknown>>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: (args: unknown, extra: unknown) => Promise<unknown>) =>
      tools.set(name, handler),
  };
  registerPostcardTools(server as never, new LobClient(), new InMemoryTokenStore(), new PieceCounter(null));

  const addr = {
    name: "Acme Co",
    address_line1: "210 King St",
    address_city: "San Francisco",
    address_state: "CA",
    address_zip: "94107",
  };
  const result = (await tools.get("lob_postcards_preview")!(
    { to: addr, from: addr, front: "<h1>front</h1>", back: "<h1>back</h1>" },
    {},
  )) as { isError?: boolean; content: Array<{ text: string }> };

  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const body = JSON.parse(result.content[0].text) as {
    confirmation_token: string;
    preview: Record<string, unknown>;
  };
  assert.ok(body.confirmation_token);
  assert.equal(body.preview.status, "completed");
  assert.equal(body.preview.url, "https://example.com/proof.pdf");
  assert.ok(body.preview.design_spec);
  assert.deepEqual(seen, [
    "POST /v1/resource_proofs",
    "GET /v1/resource_proofs/res_prf_xxxxxxxxxxxx",
    "GET /v1/resource_proofs/res_prf_xxxxxxxxxxxx",
  ]);
});
