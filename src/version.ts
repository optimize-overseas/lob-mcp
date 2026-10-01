/**
 * Server version, read from package.json when this module loads, so it can
 * never drift from the version npm published.
 *
 * Surfaced as the McpServer `version` and as the `User-Agent` on outbound Lob requests
 * so Lob can attribute traffic from this server in their dashboards / support tickets.
 *
 * `../package.json` resolves from both `src/` (tests, via tsx) and `build/`
 * (the published package), because each sits one level below the package root,
 * and npm always ships package.json in the tarball.
 */
import { createRequire } from "node:module";

export const SERVER_VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;
export const USER_AGENT = `lob-mcp/${SERVER_VERSION}`;
