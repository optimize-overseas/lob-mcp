/**
 * The version this server reports is the version it was published as.
 *
 * `SERVER_VERSION` is the MCP `serverInfo.version` and the outbound
 * `User-Agent`. It used to be a hand-maintained string, and it drifted: two
 * releases reported an older version than the package they shipped in, so a
 * client could not tell which build it was talking to. It is now read from
 * package.json, and this test pins the two together.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVER_VERSION, USER_AGENT } from "../../src/version.js";

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

test("SERVER_VERSION is the package.json version", () => {
  assert.equal(SERVER_VERSION, PACKAGE_VERSION);
});

test("USER_AGENT is lob-mcp/ plus the package.json version", () => {
  assert.equal(USER_AGENT, "lob-mcp/" + SERVER_VERSION);
  assert.equal(USER_AGENT, "lob-mcp/" + PACKAGE_VERSION);
});
