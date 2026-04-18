import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape, infer as zInfer } from "zod";
import { formatErrorForTool } from "../lob/errors.js";
import { safeStringify } from "../lob/redact.js";

export interface ToolAnnotations {
  /** Human-friendly title shown in clients that render it. */
  title?: string;
  /** Whether the tool only reads data (no side effects). */
  readOnlyHint?: boolean;
  /** Whether the tool may be destructive (e.g. delete/cancel). */
  destructiveHint?: boolean;
  /** Whether repeating the call is safe / produces the same result. */
  idempotentHint?: boolean;
  /** Whether the tool reaches an external system. Defaults to true (Lob is external). */
  openWorldHint?: boolean;
}

export interface ToolDefinition<TShape extends ZodRawShape> {
  name: string;
  description: string;
  inputSchema: TShape;
  annotations?: ToolAnnotations;
  handler: (args: { [K in keyof TShape]: zInfer<TShape[K]> }) => Promise<unknown>;
}

/**
 * Register a tool with consistent error handling and JSON content formatting.
 *
 * Errors thrown inside the handler are caught and surfaced as `isError: true` tool
 * results — they never escape to the JSON-RPC transport.
 */
export function registerTool<TShape extends ZodRawShape>(
  server: McpServer,
  def: ToolDefinition<TShape>,
): void {
  const a = def.annotations ?? {};
  server.registerTool(
    def.name,
    {
      title: a.title ?? def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: {
        ...a,
        // Lob is always an external system; default the hint accordingly.
        openWorldHint: a.openWorldHint ?? true,
      },
    },
    // The SDK's ToolCallback type is parameterised over the exact ZodRawShape and
    // resists the generic erasure here. The runtime contract (validated args in,
    // CallToolResult out) is correct, so we bridge the type boundary with `as never`.
    (async (args: unknown): Promise<CallToolResult> => {
      try {
        const result = await def.handler(args as never);
        return { content: [{ type: "text", text: stringifyResult(result) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: formatErrorForTool(err) }],
        };
      }
    }) as never,
  );
}

function stringifyResult(value: unknown): string {
  if (value === undefined || value === null) return "(no content)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // JSON.stringify throws on circular refs; safeStringify handles them via fallback.
    return safeStringify(value);
  }
}
