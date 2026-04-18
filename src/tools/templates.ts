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
import { registerTool } from "./helpers.js";

const TEMPLATE_ID = z.string().regex(/^tmpl_/).describe("Template ID (`tmpl_…`).");
const VERSION_ID = z.string().regex(/^vrsn_/).describe("Template version ID (`vrsn_…`).");

export function registerTemplateTools(server: McpServer, lob: LobClient): void {
  registerTool(server, {
    name: "lob_templates_create",
    annotations: { title: "Create a template", readOnlyHint: false },
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
    annotations: { title: "List templates", readOnlyHint: true, idempotentHint: true },
    description: "List templates on your Lob account.",
    inputSchema: { ...listParamsSchema.shape },
    handler: async (args) =>
      lob.request({ method: "GET", path: "/templates", query: compact(args) }),
  });

  registerTool(server, {
    name: "lob_templates_get",
    annotations: { title: "Retrieve a template", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a single template (including its published version) by ID.",
    inputSchema: { id: TEMPLATE_ID },
    handler: async ({ id }) => lob.request({ method: "GET", path: `/templates/${id}` }),
  });

  registerTool(server, {
    name: "lob_templates_update",
    annotations: { title: "Update a template", readOnlyHint: false, idempotentHint: true },
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
        method: "PATCH",
        path: `/templates/${id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_templates_delete",
    annotations: {
      title: "Delete a template",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description:
      "Delete a template. Mail pieces already created from it are unaffected; future references will fail.",
    inputSchema: { id: TEMPLATE_ID },
    handler: async ({ id }) => lob.request({ method: "DELETE", path: `/templates/${id}` }),
  });

  // ── Template versions ──────────────────────────────────────────────────────

  registerTool(server, {
    name: "lob_template_versions_create",
    annotations: { title: "Create a template version", readOnlyHint: false },
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
    annotations: { title: "List template versions", readOnlyHint: true, idempotentHint: true },
    description: "List all versions of a template.",
    inputSchema: {
      template_id: TEMPLATE_ID,
      ...listParamsSchema.shape,
    },
    handler: async (args) => {
      const { template_id, ...query } = args;
      return lob.request({
        method: "GET",
        path: `/templates/${template_id}/versions`,
        query: compact(query),
      });
    },
  });

  registerTool(server, {
    name: "lob_template_versions_get",
    annotations: { title: "Retrieve a template version", readOnlyHint: true, idempotentHint: true },
    description: "Retrieve a specific version of a template.",
    inputSchema: { template_id: TEMPLATE_ID, version_id: VERSION_ID },
    handler: async ({ template_id, version_id }) =>
      lob.request({ method: "GET", path: `/templates/${template_id}/versions/${version_id}` }),
  });

  registerTool(server, {
    name: "lob_template_versions_update",
    annotations: { title: "Update a template version", readOnlyHint: false, idempotentHint: true },
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
        method: "PATCH",
        path: `/templates/${template_id}/versions/${version_id}`,
        body: withExtra(rest, extra),
      });
    },
  });

  registerTool(server, {
    name: "lob_template_versions_delete",
    annotations: {
      title: "Delete a template version",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    description: "Delete a template version. Cannot delete the currently published version.",
    inputSchema: { template_id: TEMPLATE_ID, version_id: VERSION_ID },
    handler: async ({ template_id, version_id }) =>
      lob.request({ method: "DELETE", path: `/templates/${template_id}/versions/${version_id}` }),
  });
}
