/**
 * Narrow elicitation helper for high-value commits.
 *
 * Fires only when an exact-value threshold is crossed (check `amount` over USD
 * threshold or bulk `quantity` over piece threshold). Both env vars default
 * unset, so this helper is OFF by default.
 *
 * Fail-closed: if the host doesn't expose elicitInput (older client, scripted
 * client without form support), throws CONFIRMATION_DECLINED rather than
 * silently dispatching the send.
 */
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";

export interface ElicitArgs {
  title: string;
  message: string;
}

interface MaybeMcpReq {
  mcpReq?: {
    elicitInput?: (req: unknown) => Promise<{
      action: string;
      content?: unknown;
    }>;
  };
}

export async function elicitOrFail(
  serverCtx: MaybeMcpReq | undefined,
  args: ElicitArgs,
): Promise<void> {
  const elicit = serverCtx?.mcpReq?.elicitInput;
  if (!elicit) {
    throw new LobMcpError(
      LobMcpErrorCodes.CONFIRMATION_DECLINED,
      "Client does not support MCP elicitation, but a confirmation is required for this send.",
      "Use a client that supports MCP elicitation, or unset the relevant LOB_REQUIRE_ELICITATION_* env var.",
    );
  }

  const result = await elicit({
    mode: "form",
    message: args.message,
    requestedSchema: {
      type: "object",
      title: args.title,
      properties: {
        confirm: {
          type: "boolean",
          title: "I confirm this billable send",
        },
      },
      required: ["confirm"],
    },
  });

  const content = result.content as Record<string, unknown> | undefined;
  const confirmed = result.action === "accept" && content?.confirm === true;

  if (!confirmed) {
    throw new LobMcpError(
      LobMcpErrorCodes.CONFIRMATION_DECLINED,
      "User declined the high-value send confirmation.",
    );
  }
}
