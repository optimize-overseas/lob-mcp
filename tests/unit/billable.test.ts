/**
 * Drift guards for the billable-tool table.
 *
 * A spend limiter layered in front of this server can only match on tool names,
 * so it derives its counted set from BILLABLE_TOOL_NAMES. If that table ever
 * describes a smaller set than the client's own path classifier, a billable tool
 * ships uncapped - the inventory-order tools are the easy ones to miss, since
 * they are billable without being mail. These tests check the correspondence in
 * BOTH directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLABLE_TOOLS,
  BILLABLE_TOOL_NAMES,
  assertRegisteredBillable,
  isBillableToolName,
} from "../../src/safety/billable.js";
import { BILLABLE_POST_PATHS, classifyOperation } from "../../src/lob/client.js";

test("every billable tool's path classifies as a commit", () => {
  for (const { baseName, samplePath } of BILLABLE_TOOLS) {
    assert.equal(
      classifyOperation("POST", samplePath),
      "commit",
      `${baseName}: POST ${samplePath} must classify as commit, not mutation/read`,
    );
  }
});

test("every billable POST path has a tool entry (no uncounted billable path)", () => {
  for (const rx of BILLABLE_POST_PATHS) {
    const covered = BILLABLE_TOOLS.some((t) => rx.test(t.samplePath));
    assert.ok(
      covered,
      `BILLABLE_POST_PATHS entry ${rx} has no matching tool in src/safety/billable.ts. ` +
        "A billable endpoint with no tool entry is invisible to the out-of-process spend cap.",
    );
  }
});

test("every billable tool entry is matched by a billable POST path", () => {
  for (const { baseName, samplePath } of BILLABLE_TOOLS) {
    const covered = BILLABLE_POST_PATHS.some((rx) => rx.test(samplePath));
    assert.ok(covered, `${baseName}: ${samplePath} matches no BILLABLE_POST_PATHS entry`);
  }
});

test("BILLABLE_TOOL_NAMES is the _create arm of every entry", () => {
  assert.deepEqual(
    [...BILLABLE_TOOL_NAMES].sort(),
    [
      "lob_buckslip_orders_create",
      "lob_card_orders_create",
      "lob_checks_create",
      "lob_letters_create",
      "lob_postcards_create",
      "lob_self_mailers_create",
    ],
    "the known billable tool set changed - downstream spend limits must be updated too",
  );
  assert.ok(isBillableToolName("lob_letters_create"));
  assert.ok(!isBillableToolName("lob_letters_preview"));
  assert.ok(!isBillableToolName("lob_letters_cancel"));
  assert.ok(!isBillableToolName("lob_us_verifications_verify"));
});

test("registering an unlisted preview/commit pair throws at boot", () => {
  assert.throws(
    () => assertRegisteredBillable("lob_flyers"),
    /not listed in src\/safety\/billable\.ts/,
  );
  for (const { baseName } of BILLABLE_TOOLS) {
    assert.doesNotThrow(() => assertRegisteredBillable(baseName));
  }
});
