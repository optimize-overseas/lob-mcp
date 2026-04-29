/**
 * Server version. Single source of truth — keep in sync with `version` in package.json.
 *
 * Surfaced as the McpServer `version` and as the `User-Agent` on outbound Lob requests
 * so Lob can attribute traffic from this server in their dashboards / support tickets.
 */
export const SERVER_VERSION = "1.1.0";
export const USER_AGENT = `lob-mcp/${SERVER_VERSION}`;
