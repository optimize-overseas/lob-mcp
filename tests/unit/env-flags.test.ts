/**
 * The shared boolean-flag vocabulary.
 *
 * A spend limiter in front of this server arms off the SAME LOB_LIVE_MODE value
 * this server goes live on. When two layers parse it differently, a spelling
 * like `1` or `yes` produces real mail with the limiter never armed. The safety
 * property proved below - "anything this server reads as live is also NOT
 * explicitly disabled" - is what lets such a caller arm fail-closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExplicitlyDisabled, parseBool } from "../../src/env-flags.js";

/** Every spelling either layer might realistically see. */
const SPELLINGS: (string | undefined)[] = [
  undefined, "", "   ",
  "1", "true", "TRUE", "True", " true", "true ", "yes", "YES", "on", "ON",
  "0", "false", "FALSE", " false ", "no", "NO", "off", "OFF",
  "treu", "ture", "2", "-1", "enabled", "disabled", "y", "n", "null",
];

test("parseBool accepts the documented truthy spellings, trimmed and case-insensitive", () => {
  for (const raw of ["1", "true", "TRUE", "True", " true", "true ", "yes", "YES", "on", "ON"]) {
    assert.equal(parseBool(raw, false), true, `${JSON.stringify(raw)} should parse true`);
  }
});

test("parseBool falls back only when unset", () => {
  assert.equal(parseBool(undefined, false), false);
  assert.equal(parseBool(undefined, true), true);
  // A value that is present but unrecognised is NOT the fallback - it is false.
  assert.equal(parseBool("treu", true), false);
});

test("isExplicitlyDisabled is true only for unset, empty, or an off-spelling", () => {
  for (const raw of [undefined, "", "   ", "0", "false", "FALSE", " false ", "no", "NO", "off", "OFF"]) {
    assert.equal(isExplicitlyDisabled(raw), true, `${JSON.stringify(raw)} should read as disabled`);
  }
  for (const raw of ["1", "true", "yes", "on", " true", "treu", "2", "enabled"]) {
    assert.equal(isExplicitlyDisabled(raw), false, `${JSON.stringify(raw)} should NOT read as disabled`);
  }
});

test("SAFETY PROPERTY: live-mode-true implies not-explicitly-disabled", () => {
  // This is the invariant the fail-closed cap depends on. If it ever fails,
  // some spelling makes the server go live while a `!isExplicitlyDisabled`
  // caller stands down - the exact defect this module was created to kill.
  for (const raw of SPELLINGS) {
    if (parseBool(raw, false)) {
      assert.equal(
        isExplicitlyDisabled(raw),
        false,
        `${JSON.stringify(raw)} enables live mode but reads as disabled - cap would not arm`,
      );
    }
  }
});
