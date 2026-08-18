/**
 * The single source of truth for "which TOOL costs money".
 *
 * `lob/client.ts` already classifies billable work by HTTP path
 * (`BILLABLE_POST_PATHS`), which is the right granularity for key selection and
 * the idempotency assertion. But a spend limiter layered in front of this server
 * only ever sees MCP TOOL NAMES on the wire. It cannot see paths, so without an
 * export like this one it has to re-list the billable tools by hand - and a
 * hand-copied list drifts silently, which is how the two inventory-order tools
 * end up uncounted. Exporting the mapping means no other layer re-lists it.
 *
 * Two rails keep this honest, so a seventh billable resource cannot be added
 * without this file learning about it:
 *
 *   1. `buildPreviewCommit()` - the only way a billable commit tool is created -
 *      asserts its `baseName` appears below, and THROWS at registration time
 *      (i.e. the server refuses to boot) if it does not.
 *   2. `tests/unit/billable.test.ts` proves this table and `BILLABLE_POST_PATHS`
 *      describe the same set in BOTH directions: every tool here classifies as
 *      `commit`, and every billable path here has a tool.
 *
 * Keep this module free of imports and side effects - it is loaded by another
 * package, which must not have to construct a client or supply Lob credentials
 * just to learn what is billable.
 */

/**
 * One entry per billable Lob resource.
 *
 * `baseName` is what `buildPreviewCommit` is called with; the registered tools
 * are `${baseName}_preview` (free) and `${baseName}_create` (BILLABLE).
 * `samplePath` is a representative POST path for that resource, used by the
 * drift test to check it against the client's own path classifier.
 */
export const BILLABLE_TOOLS: readonly {
  readonly baseName: string;
  readonly samplePath: string;
}[] = [
  { baseName: "lob_postcards", samplePath: "/postcards" },
  { baseName: "lob_letters", samplePath: "/letters" },
  { baseName: "lob_self_mailers", samplePath: "/self_mailers" },
  { baseName: "lob_checks", samplePath: "/checks" },
  // Inventory ORDERS: Lob prints and stocks physical units. One call can
  // represent many thousands of pieces, so these are billable too.
  { baseName: "lob_buckslip_orders", samplePath: "/buckslips/bck_sample/orders" },
  { baseName: "lob_card_orders", samplePath: "/cards/card_sample/orders" },
];

/** `baseName`s that `buildPreviewCommit` may be called with. */
export const BILLABLE_BASE_NAMES: ReadonlySet<string> = new Set(
  BILLABLE_TOOLS.map((t) => t.baseName),
);

/**
 * Every tool name that commits billable work. This is the set an external
 * spend-limiting layer must count.
 */
export const BILLABLE_TOOL_NAMES: ReadonlySet<string> = new Set(
  BILLABLE_TOOLS.map((t) => `${t.baseName}_create`),
);

/** True when `name` is a tool that spends money in live mode. */
export function isBillableToolName(name: string): boolean {
  return BILLABLE_TOOL_NAMES.has(name);
}

/**
 * Assert that a preview/commit pair being registered is a known billable
 * resource. Called by `buildPreviewCommit`, so a new billable tool that skipped
 * this table fails LOUDLY at boot rather than shipping uncapped.
 */
export function assertRegisteredBillable(baseName: string): void {
  if (!BILLABLE_BASE_NAMES.has(baseName)) {
    throw new Error(
      `buildPreviewCommit("${baseName}") is not listed in src/safety/billable.ts. ` +
        "The preview/commit flow exists for BILLABLE resources, and out-of-process spend " +
        "limits are derived from BILLABLE_TOOL_NAMES - registering without adding an entry " +
        "there would ship an uncapped billable tool. Add { baseName, samplePath } to " +
        "BILLABLE_TOOLS (and the path to BILLABLE_POST_PATHS in src/lob/client.ts).",
    );
  }
}
