/**
 * Interactive setup wizard.
 *
 * Invoked when the server is started with `lob-mcp init`. Prompts for keys and
 * safety caps, then prints a paste-ready Claude Desktop config snippet and a
 * `claude mcp add` one-liner. Returns true when the wizard handled the args
 * (caller should exit before loading env or starting the server).
 *
 * The wizard never writes to disk — it only emits to stdout. Users still
 * copy/paste into their host's config, avoiding any risk of clobbering an
 * existing config block.
 *
 * Implementation note: uses an async-iterator on a readline interface to read
 * lines from stdin. This works under both TTY and piped/non-TTY input — the
 * `rl.question` promises API is flaky on piped stdin in older Node releases.
 */
import * as readline from "node:readline";
import { stdin, stdout } from "node:process";

export async function runWizardIfRequested(argv: string[]): Promise<boolean> {
  if (argv[0] !== "init") return false;

  stdout.write("\nlob-mcp setup wizard\n--------------------\n\n");

  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();

  async function ask(prompt: string): Promise<string> {
    stdout.write(prompt);
    const next = await lines.next();
    if (next.done) return "";
    return String(next.value).trim();
  }

  try {
    const testKey = await ask("Lob TEST API key (test_…): ");
    if (!testKey.startsWith("test_")) {
      stdout.write("Error: test key must start with test_\n");
      process.exitCode = 1;
      return true;
    }

    const liveKey = await ask("Lob LIVE API key (live_…), or leave blank: ");
    if (liveKey && !liveKey.startsWith("live_")) {
      stdout.write("Error: live key must start with live_\n");
      process.exitCode = 1;
      return true;
    }

    let enableLive = false;
    if (liveKey) {
      const answer = (await ask("Enable live mode now? (y/N): ")).toLowerCase();
      enableLive = answer === "y" || answer === "yes";
    }

    const maxPieces = await ask(
      "Max pieces per run (recommended: 10 for personal use, blank for none): ",
    );
    const elicitChecks = await ask(
      "Elicit confirmation for checks over $ amount (blank for off): ",
    );
    const elicitBulk = await ask(
      "Elicit confirmation for bulk orders over N pieces (blank for off): ",
    );

    const env: Record<string, string> = { LOB_TEST_API_KEY: testKey };
    if (liveKey) env.LOB_LIVE_API_KEY = liveKey;
    if (enableLive) env.LOB_LIVE_MODE = "true";
    if (maxPieces) env.LOB_MAX_PIECES_PER_RUN = maxPieces;
    if (elicitChecks) env.LOB_REQUIRE_ELICITATION_FOR_CHECKS_OVER_USD = elicitChecks;
    if (elicitBulk) env.LOB_REQUIRE_ELICITATION_FOR_BULK_OVER_PIECES = elicitBulk;

    stdout.write(
      "\nClaude Desktop config snippet (add under \"mcpServers\" in claude_desktop_config.json):\n\n",
    );
    stdout.write(
      JSON.stringify(
        { lob: { command: "npx", args: ["-y", "lob-mcp"], env } },
        null,
        2,
      ),
    );
    stdout.write("\n\nClaude Code one-liner:\n\n");
    const cliEnv = Object.entries(env)
      .map(([k, v]) => `--env ${k}=${shellQuote(v)}`)
      .join(" ");
    stdout.write(`claude mcp add lob ${cliEnv} -- npx -y lob-mcp\n\n`);
    stdout.write(
      "Cursor / other clients: set the same env vars in your MCP server entry.\n\n",
    );
    return true;
  } finally {
    rl.close();
  }
}

function shellQuote(value: string): string {
  // Wrap in single quotes if the value contains anything beyond [A-Za-z0-9_./:-]
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}
