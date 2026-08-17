/**
 * "Did this failed call reach Lob?" — the classification an out-of-process
 * spend limiter uses to decide whether a failed billable call gives its slot
 * back.
 *
 * The dangerous answer is the optimistic one. lob-mcp aborts its own request at
 * LOB_REQUEST_TIMEOUT_MS (30s by default), and that abort also fires while
 * reading the response body — so a create Lob has already accepted, billed and
 * printed can surface here as an error. Treating that as "nothing was sent" is
 * how a Lob slowdown becomes unlimited uncounted mail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyErrorDispatch,
  LOB_DISPATCH_META_KEY,
  LobApiError,
  LobMcpError,
  LobMcpErrorCodes,
  LobTimeoutError,
} from "../../src/lob/errors.js";

test("our own guards are proven pre-dispatch", () => {
  for (const code of Object.values(LobMcpErrorCodes)) {
    assert.equal(
      classifyErrorDispatch(new LobMcpError(code, "refused")),
      "not_sent",
      `${code} fires before the network call`,
    );
  }
});

test("a 4xx is Lob rejecting the request outright", () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    assert.equal(
      classifyErrorDispatch(new LobApiError({ status, message: "rejected" })),
      "not_sent",
      `HTTP ${status} created nothing`,
    );
  }
});

test("SAFETY: a timeout is indeterminate, never not_sent", () => {
  assert.equal(
    classifyErrorDispatch(new LobTimeoutError("/letters", 30_000)),
    "indeterminate",
    "the piece may exist - Lob can accept a create whose response never arrives",
  );
});

test("SAFETY: a 5xx is indeterminate", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      classifyErrorDispatch(new LobApiError({ status, message: "server error" })),
      "indeterminate",
      `HTTP ${status} can follow a successful create at Lob's edge`,
    );
  }
});

test("SAFETY: an unrecognised error defaults to indeterminate", () => {
  // An error shape we do not know is not evidence that nothing was sent.
  assert.equal(classifyErrorDispatch(new Error("boom")), "indeterminate");
  assert.equal(classifyErrorDispatch("a string"), "indeterminate");
  assert.equal(classifyErrorDispatch(undefined), "indeterminate");
  assert.equal(classifyErrorDispatch({ status: 400 }), "indeterminate");
});

test("the _meta key is a published contract", () => {
  // lob-enforcement-wrapper reads this exact string. Changing it silently
  // downgrades that wrapper to "never release a slot" — safe, but wrong.
  assert.equal(LOB_DISPATCH_META_KEY, "com.lob.mcp/dispatch");
});
