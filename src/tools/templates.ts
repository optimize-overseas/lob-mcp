/**
 * Template tools — reusable HTML for mail pieces, plus per-template versions.
 *
 * Creating a new template version does NOT publish it; callers must explicitly
 * set `published_version` via `lob_templates_update` to roll the change forward.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import {
  compact,
  extraParamsSchema,
  listParamsSchema,
  metadataSchema,
  withExtra,
} from "../schemas/common.js";
import { ToolAnnotationPresets, registerTool } from "./helpers.js";
import {
  slimTemplate,
  slimTemplateList,
  slimTemplateVersionList,
} from "./templates-slim.js";

const TEMPLATE_ID = z.string().regex(/^tmpl_/).describe("Template ID (`tmpl_…`).");
const VERSION_ID = z.string().regex(/^vrsn_/).describe("Template version ID (`vrsn_…`).");

const includeHtmlSchema = z
  .boolean()
  .optional()
  .describe(
    "Include the full HTML body in each list entry. Defaults to false: HTML can be tens of MB and " +
      "blows the LLM context. Use `lob_templates_get(id)` to read the full template once you know which one you want.",
  );

/** Maximum bytes of stringified JSON we ever return from a list-style tool. */
const MAX_LIST_RESPONSE_BYTES = 1_500_000;
function guardListSize(payload: unknown, toolName: string): unknown {
  const size = JSON.stringify(payload).length;
  if (size > MAX_LIST_RESPONSE_BYTES) {
    throw new Error(
      `${toolName} response is ${size} bytes — too large to return safely. ` +
        `Reduce \`limit\`, omit \`include_html\`, or use \`lob_templates_search\` to narrow the result set.`,
    );
  }
  return payload;
}

export function registerTemplateTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_templates_create",
    annotations: { title: "Create a template", ...ToolAnnotationPresets.mutate },
    description:
      "Create a reusable HTML template that can be referenced by ID (`tmpl_…`) when creating mail pieces. " +
      "Supports Handlebars-style `{{variables}}` for runtime substitution.",
    inputSchema: {
      description: z.string().max(255).optional(),
      html: z.string().describe("HTML content of the template (UTF-8)."),
      engine: z
        .enum(["legacy", "handlebars"])
        .optional()
        .describe("Template engine. Defaults to 'handlebars'."),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: "/templates",
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_templates_list",
    annotations: { title: "List templates", ...ToolAnnotationPresets.read },
    description:
      "List templates on your Lob account. By default returns slim records (no HTML body) — " +
      "Lob template HTML can be many MB per entry and quickly overwhelms LLM context. Pass " +
      "`include_html: true` to get the full HTML, or use `lob_templates_get(id)` for a single template.",
    inputSchema: { ...listParamsSchema.shape, include_html: includeHtmlSchema },
    handler: async (args) => {
      const { include_html, ...rest } = args;
      const raw = await lob.request({
        method: "GET",
        path: "/templates",
        query: compact(rest),
      });
      const shaped = include_html ? raw : slimTemplateList(raw);
      return guardListSize(shaped, "lob_templates_list");
    },
  });

  registerTool(server, {
    name: "lob_templates_get",
    annotations: { title: "Retrieve a template", ...ToolAnnotationPresets.read },
    description: "Retrieve a single template (including its published version) by ID.",
    inputSchema: { id: TEMPLATE_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/templates/${id}` }),
  });

  registerTool(server, {
    name: "lob_templates_search",
    annotations: { title: "Search templates", ...ToolAnnotationPresets.read },
    description:
      "Find templates by description substring (case-insensitive) and/or by Lob metadata. Pages " +
      "through `/templates` server-side and returns slim matches (no HTML — use `lob_templates_get(id)` " +
      "for the full body). Useful when you know the template by name but not by `tmpl_…` id.",
    inputSchema: {
      description_contains: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Substring to match against each template's `description` field. Case-insensitive. " +
            "Filtered client-side after pages are fetched.",
        ),
      metadata: z
        .record(z.string())
        .optional()
        .describe(
          "Forwarded to Lob as a `metadata[k]=v` filter. Use this to narrow the page walk on " +
            "the server side before client-side description matching.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum matches to return (default 20, max 100)."),
      max_pages: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe(
          "Maximum number of Lob list pages to walk before stopping (default 5, page size 100). " +
            "Caps total templates inspected at max_pages × 100.",
        ),
    },
    handler: async (args) => {
      const needle = args.description_contains?.toLowerCase();
      const metadata = args.metadata;
      if (!needle && (!metadata || Object.keys(metadata).length === 0)) {
        throw new Error(
          "lob_templates_search requires at least one of `description_contains` or `metadata`.",
        );
      }
      const limit = args.limit ?? 20;
      const maxPages = args.max_pages ?? 5;
      const pageSize = 100;

      const matches: unknown[] = [];
      let after: string | undefined;
      let pagesSearched = 0;
      let truncated = false;
      let moreAvailable = false;

      pageLoop: for (let p = 0; p < maxPages; p++) {
        const page = (await lob.request<{
          data?: { id: string; description?: string | null }[];
          next_url?: string | null;
        }>({
          method: "GET",
          path: "/templates",
          query: compact({ limit: pageSize, after, metadata }),
        })) as {
          data?: { id: string; description?: string | null }[];
          next_url?: string | null;
        };
        pagesSearched++;
        const data = page.data ?? [];
        for (const t of data) {
          if (needle) {
            const desc = (t.description ?? "").toLowerCase();
            if (!desc.includes(needle)) continue;
          }
          matches.push(slimTemplate(t));
          if (matches.length >= limit) {
            truncated = true;
            // Determine moreAvailable: there were more rows in this page or a next_url existed.
            const hadMoreThisPage = data.indexOf(t) < data.length - 1;
            moreAvailable = hadMoreThisPage || Boolean(page.next_url);
            break pageLoop;
          }
        }
        if (!page.next_url) break;
        const last = data[data.length - 1];
        if (!last) break;
        after = last.id;
        if (p === maxPages - 1) {
          // Walked the cap and there were more pages still — truncated.
          truncated = true;
          moreAvailable = true;
        }
      }

      return {
        object: "list",
        count: matches.length,
        data: matches,
        pages_searched: pagesSearched,
        truncated,
        more_available: moreAvailable,
      };
    },
  });

  registerTool(server, {
    name: "lob_templates_update",
    annotations: { title: "Update a template", ...ToolAnnotationPresets.mutate },
    description:
      "Update a template's metadata or published version. To publish a new version, set " +
      "`published_version` to a version ID (`vrsn_…`).",
    inputSchema: {
      id: TEMPLATE_ID,
      description: z.string().max(255).optional(),
      published_version: z.string().regex(/^vrsn_/).optional(),
      metadata: metadataSchema,
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { id, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/templates/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_templates_delete",
    annotations: { title: "Delete a template", ...ToolAnnotationPresets.destructive },
    description:
      "Delete a template. Mail pieces already created from it are unaffected; future references will fail.",
    inputSchema: { id: TEMPLATE_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/templates/${id}` }),
  });

  // ── Template versions ──────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_template_versions_create",
    annotations: { title: "Create a template version", ...ToolAnnotationPresets.mutate },
    description:
      "Add a new version of a template's HTML. Creating a new version does NOT automatically publish it — " +
      "use `lob_templates_update` to set `published_version`.",
    inputSchema: {
      template_id: TEMPLATE_ID,
      description: z.string().max(255).optional(),
      html: z.string().describe("HTML content for this version."),
      engine: z.enum(["legacy", "handlebars"]).optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { template_id, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/templates/${template_id}/versions`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_template_versions_list",
    annotations: { title: "List template versions", ...ToolAnnotationPresets.read },
    description:
      "List all versions of a template. Slim by default (no HTML); pass `include_html: true` " +
      "to get the full HTML body of each version, or use `lob_template_versions_get(template_id, version_id)`.",
    inputSchema: {
      template_id: TEMPLATE_ID,
      ...listParamsSchema.shape,
      include_html: includeHtmlSchema,
    },
    handler: async (args) => {
      const { template_id, include_html, ...query } = args;
      const raw = await lob.request({
        method: "GET",
        path: `/templates/${template_id}/versions`,
        query: compact(query),
      });
      const shaped = include_html ? raw : slimTemplateVersionList(raw);
      return guardListSize(shaped, "lob_template_versions_list");
    },
  });

  registerTool(server, {
    name: "lob_template_versions_get",
    annotations: { title: "Retrieve a template version", ...ToolAnnotationPresets.read },
    description: "Retrieve a specific version of a template.",
    inputSchema: { template_id: TEMPLATE_ID, version_id: VERSION_ID },
    handler: async ({ template_id, version_id }) =>
      lob.request({ method: "GET", path: `/templates/${template_id}/versions/${version_id}` }),
  });

  registerTool(server, {
    name: "lob_template_versions_update",
    annotations: { title: "Update a template version", ...ToolAnnotationPresets.mutate },
    description: "Update the description of a template version. HTML cannot be modified after creation.",
    inputSchema: {
      template_id: TEMPLATE_ID,
      version_id: VERSION_ID,
      description: z.string().max(255).optional(),
      extra: extraParamsSchema,
    },
    handler: async (args) => {
      const { template_id, version_id, extra, ...rest } = args;
      return lob.request({
        method: "POST",
        path: `/templates/${template_id}/versions/${version_id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_template_versions_delete",
    annotations: { title: "Delete a template version", ...ToolAnnotationPresets.destructive },
    description: "Delete a template version. Cannot delete the currently published version.",
    inputSchema: { template_id: TEMPLATE_ID, version_id: VERSION_ID },
    handler: async ({ template_id, version_id }) =>
      lob.request({ method: "DELETE", path: `/templates/${template_id}/versions/${version_id}` }),
  });
}
