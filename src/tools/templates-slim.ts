/**
 * Slim transforms for Lob template responses.
 *
 * Lob's `/templates` and `/templates/{id}/versions` endpoints embed the full
 * HTML of every published version AND every historical version in the list
 * payload — pages can balloon to tens of MB on accounts with image-heavy
 * templates. That blows MCP transport budgets and LLM context windows.
 *
 * `slimTemplate` / `slimTemplateVersion` strip the HTML body while preserving
 * everything the LLM actually needs to choose and use a template:
 *   • id, description, dates, metadata, product/variant
 *   • merge_variables.keys (so the model knows what to fill in)
 *   • the version list (without the per-version HTML)
 *
 * Both helpers are pure and never mutate their input.
 */

interface UnknownObject {
  [k: string]: unknown;
}

function isObj(x: unknown): x is UnknownObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Drop `html` from a version-shaped object. Preserves everything else. */
export function slimTemplateVersion<T>(version: T): T {
  if (!isObj(version)) return version;
  const { html: _html, ...rest } = version as UnknownObject & { html?: unknown };
  return rest as T;
}

/**
 * Strip the heavy fields from a Lob template record for safe inclusion in a
 * list response, without mutating the input. Specifically:
 *   • drop `published_version.html` (often hundreds of KB or more)
 *   • drop `versions[]` entirely — busy templates ship with 100+ historical
 *     versions, each with their own merge_variables and metadata, ballooning
 *     a "slim" list to several MB. Replaced with `version_count`. Callers who
 *     need the full version history can hit `lob_template_versions_list`.
 *
 * `published_version.merge_variables.keys` is preserved intact — the LLM
 * needs that to know which Handlebars variables it must supply.
 */
export function slimTemplate<T>(template: T): T {
  if (!isObj(template)) return template;
  const out: UnknownObject = { ...template };
  if (isObj(out.published_version)) {
    out.published_version = slimTemplateVersion(out.published_version);
  }
  if (Array.isArray(out.versions)) {
    out.version_count = out.versions.length;
    delete out.versions;
  }
  return out as T;
}

/**
 * Apply `slimTemplate` to every entry of a Lob list response (`{ data: [...] }`)
 * without mutating the input. Non-list shapes are returned unchanged.
 */
export function slimTemplateList<T>(response: T): T {
  if (!isObj(response)) return response;
  const data = (response as UnknownObject).data;
  if (!Array.isArray(data)) return response;
  return { ...response, data: data.map((t) => slimTemplate(t)) } as T;
}

/**
 * Apply `slimTemplateVersion` to every entry of a Lob list response.
 */
export function slimTemplateVersionList<T>(response: T): T {
  if (!isObj(response)) return response;
  const data = (response as UnknownObject).data;
  if (!Array.isArray(data)) return response;
  return { ...response, data: data.map((v) => slimTemplateVersion(v)) } as T;
}
