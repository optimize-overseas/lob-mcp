/**
 * Boolean environment-flag parsing, factored out of `env.ts` so that an
 * OUT-OF-PROCESS caller can import the exact same predicate.
 *
 * Why this is its own module: a proxy or supervisor layered in front of this
 * server often needs to read `LOB_LIVE_MODE` too - to decide whether to enforce
 * a spend limit, for instance. If it re-implements the parse as `=== "true"`,
 * the two layers disagree for every non-canonical spelling (`1`, `TRUE`, `yes`,
 * `on`, `" true"`): this server goes fully live while the caller believes it is
 * in test mode and stands its own guard down. The defect is duplication, so the
 * fix is a single exported predicate plus the explicit "off" vocabulary a
 * fail-closed caller needs. Keep this module free of dependencies and side
 * effects - it is imported by other packages.
 */

/** Spellings accepted as TRUE. */
const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * Spellings accepted as an unambiguous FALSE. Deliberately NOT the complement of
 * TRUTHY: a value like `treu` or `2` is neither, i.e. it is a typo. `parseBool`
 * resolves a typo to `fallback`; `isExplicitlyDisabled` reports it as NOT
 * disabled, so a caller that must fail closed (the rate cap) can over-protect on
 * exactly the inputs a human got wrong.
 */
const FALSY = /^(0|false|no|off)$/i;

/**
 * Parse a boolean env var. Unset (or any value that is neither truthy nor falsy)
 * resolves to `fallback`.
 */
export function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return TRUTHY.test(raw.trim());
}

/**
 * True only when `raw` is unset, empty, or an unambiguous off-spelling.
 *
 * The intended use is the inverse: `!isExplicitlyDisabled(raw)` is the
 * fail-closed reading of a safety flag - it treats anything a human might have
 * meant as "on" (including a misspelling) as on. It is a strict superset of
 * `parseBool(raw, false)`, which `tests/unit/env-flags.test.ts` proves.
 */
export function isExplicitlyDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  return FALSY.test(trimmed);
}
