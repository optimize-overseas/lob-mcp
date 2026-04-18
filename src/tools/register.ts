/**
 * Single entry point that wires every resource group's tools into the MCP server.
 *
 * Order matters only insofar as it controls the order tools appear in `tools/list`
 * responses; the groups are otherwise independent.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import { registerAddressBookTools } from "./address-book.js";
import { registerBankAccountTools } from "./bank-accounts.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerCheckTools } from "./checks.js";
import { registerLetterTools } from "./letters.js";
import { registerPostcardTools } from "./postcards.js";
import { registerSelfMailerTools } from "./self-mailers.js";
import { registerTemplateTools } from "./templates.js";
import { registerTrackingTools } from "./tracking.js";
import { registerUploadsTools } from "./uploads.js";
import { registerVerificationTools } from "./verifications.js";
import { registerWebhookTools } from "./webhooks.js";

export function registerAllTools(server: McpServer, lob: LobClient): void {
  registerAddressBookTools(server, lob);
  registerVerificationTools(server, lob);
  registerPostcardTools(server, lob);
  registerLetterTools(server, lob);
  registerSelfMailerTools(server, lob);
  registerCheckTools(server, lob);
  registerTemplateTools(server, lob);
  registerCampaignTools(server, lob);
  registerUploadsTools(server, lob);
  registerBankAccountTools(server, lob);
  registerTrackingTools(server, lob);
  registerWebhookTools(server, lob);
}
