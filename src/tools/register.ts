/**
 * Single entry point that wires every resource group's tools into the MCP server.
 *
 * Order matters only insofar as it controls the order tools appear in
 * `tools/list` responses; the groups are otherwise independent.
 *
 * The billable groups (postcards, letters, self-mailers, checks, uploads' order
 * tools) receive the shared `tokenStore` and `pieceCounter` for preview/commit
 * binding and piece-cap enforcement. Other groups receive only `lob`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LobClient } from "../lob/client.js";
import type { TokenStore } from "../preview/token-store.js";
import type { PieceCounter } from "../safety/piece-counter.js";
import { registerAddressBookTools } from "./address-book.js";
import { registerBankAccountTools } from "./bank-accounts.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerCheckTools } from "./checks.js";
import { registerLetterTools } from "./letters.js";
import { registerPostcardTools } from "./postcards.js";
import { registerSelfMailerTools } from "./self-mailers.js";
import { registerTemplateTools } from "./templates.js";
import { registerUploadsTools } from "./uploads.js";
import { registerVerificationTools } from "./verifications.js";
import { registerWebhookTools } from "./webhooks.js";

export function registerAllTools(
  server: McpServer,
  lob: LobClient,
  tokenStore: TokenStore,
  pieceCounter: PieceCounter,
): void {
  registerAddressBookTools(server, lob);
  registerVerificationTools(server, lob);
  registerPostcardTools(server, lob, tokenStore, pieceCounter);
  registerLetterTools(server, lob, tokenStore, pieceCounter);
  registerSelfMailerTools(server, lob, tokenStore, pieceCounter);
  registerCheckTools(server, lob, tokenStore, pieceCounter);
  registerTemplateTools(server, lob);
  registerCampaignTools(server, lob);
  registerUploadsTools(server, lob, tokenStore, pieceCounter);
  registerBankAccountTools(server, lob);
  registerWebhookTools(server, lob);
}
