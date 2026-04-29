/**
 * Registers design-spec resources and the fallback tool with the MCP server.
 *
 * Surfaces (all reading from src/specs/manifest.ts):
 *   • lob://specs/{mail_type}/{variant}.json — JSON spec via ResourceTemplate
 *   • lob://specs/{mail_type}/{variant}.pdf  — bundled PDF as base64 blob,
 *     one static registerResource call per spec entry that has a PDF
 *   • lob_design_specs_get(mail_type, variant) — fallback tool returning the
 *     JSON inline, for hosts that under-implement MCP resources
 *
 * The resource template uses RFC 6570 syntax. The list callback enumerates
 * every (mail_type, variant) so hosts can populate a picker.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSpec, SPEC_MANIFEST } from "./manifest.js";
import { loadPdfTemplate } from "./pdf-loader.js";
import { ToolAnnotationPresets, registerTool } from "../tools/helpers.js";

export function registerSpecsResources(server: McpServer): void {
  // ── JSON spec — parameterized resource ───────────────────────────────────
  server.registerResource(
    "lob_design_specs_json",
    new ResourceTemplate("lob://specs/{mail_type}/{variant}.json", {
      list: async () => ({
        resources: SPEC_MANIFEST.map((s) => ({
          uri: `lob://specs/${s.mail_type}/${s.variant}.json`,
          name: `${s.title} — JSON spec`,
          description: s.human_readable_summary,
          mimeType: "application/json",
          annotations: { audience: ["assistant", "user"], priority: 0.9 },
        })),
      }),
    }),
    {
      title: "Lob design specifications (JSON)",
      description:
        "Structured dimensions, bleed, safe area, no-print zones, and file-format requirements for every supported (mail_type, variant) combination. Read this BEFORE designing a mail piece so artwork respects Lob's auto-stamped address blocks.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const mailType = String(variables.mail_type);
      const variant = String(variables.variant);
      const spec = findSpec(mailType, variant);
      if (!spec) {
        const available = SPEC_MANIFEST.map(
          (s) => `${s.mail_type}/${s.variant}`,
        ).join(", ");
        throw new Error(`No spec for ${mailType}/${variant}. Available: ${available}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(spec, null, 2),
          },
        ],
      };
    },
  );

  // ── PDF templates — one static resource per bundled file ─────────────────
  for (const spec of SPEC_MANIFEST) {
    if (!spec.references.mcp_resource_uri) continue;
    const pdfUri = spec.references.mcp_resource_uri;
    const resourceName =
      `lob_design_specs_pdf_${spec.mail_type}_${spec.variant}`.replace(
        /[^a-zA-Z0-9_]/g,
        "_",
      );
    server.registerResource(
      resourceName,
      pdfUri,
      {
        title: `${spec.title} — Lob template PDF`,
        description: `Lob's official template PDF showing trim, bleed, and safe-area boundaries. Source: ${spec.references.lob_source_url}`,
        mimeType: "application/pdf",
        annotations: { audience: ["user", "assistant"], priority: 0.7 },
      },
      async (uri) => {
        const pdf = loadPdfTemplate(spec.mail_type, spec.variant);
        if (!pdf) {
          throw new Error(
            `PDF for ${spec.mail_type}/${spec.variant} not found in build/specs/pdfs/. Did you run \`node scripts/download-spec-pdfs.mjs && npm run build\`?`,
          );
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: pdf.mimeType,
              blob: pdf.base64,
            },
          ],
        };
      },
    );
  }

  // ── Fallback tool — same JSON, model-driven access ───────────────────────
  registerTool(server, {
    name: "lob_design_specs_get",
    annotations: {
      title: "Get Lob design spec",
      ...ToolAnnotationPresets.read,
    },
    description:
      "Return the design specification (dimensions, bleed, safe area, no-print zones, file requirements) for a Lob mail-piece variant. Call this BEFORE generating artwork so the design respects Lob's auto-stamped address blocks. Same data is also available as MCP resources at lob://specs/{mail_type}/{variant}.json.",
    inputSchema: {
      mail_type: z
        .enum(["postcard", "letter", "self_mailer", "check", "buckslip", "card"])
        .describe("Mail-piece category."),
      variant: z
        .string()
        .describe(
          "Variant identifier within the mail_type. For postcards: 4x6, 6x9, 6x11. " +
            "For letters: standard_no10, flat_9x12, legal_8.5x14, custom_envelope. " +
            "For self-mailers: 6x18_bifold, 11x9_bifold. " +
            "For checks: standard. For buckslip / card: standard.",
        ),
    },
    handler: async ({ mail_type, variant }) => {
      const spec = findSpec(mail_type, variant);
      if (!spec) {
        const available = SPEC_MANIFEST.filter((s) => s.mail_type === mail_type)
          .map((s) => s.variant)
          .join(", ");
        throw new Error(
          `No spec for ${mail_type}/${variant}. Available variants for ${mail_type}: ${available || "(none)"}.`,
        );
      }
      return spec;
    },
  });
}
