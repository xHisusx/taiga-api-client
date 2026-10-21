import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, HELP_TEXT, loadConfig, parseArgs } from "./config.js";
import { createServer, SERVER_VERSION } from "./server.js";

/**
 * stdio is the MCP channel — anything written to stdout corrupts the protocol frame,
 * so every diagnostic goes to stderr.
 */
function log(message: string): void {
  process.stderr.write(`[taiga-mcp] ${message}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);

  if (flags["help"] || flags["h"]) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (flags["version"] || flags["v"]) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  let config;
  try {
    config = loadConfig(process.env, argv);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n\n${HELP_TEXT}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { server, tools } = createServer({ config });
  const transport = new StdioServerTransport();

  const shutdown = async (signal: string): Promise<void> => {
    log(`received ${signal}, shutting down`);
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);

  const mode = config.readOnly ? "read-only" : config.allowDelete ? "read-write +delete" : "read-write";
  log(
    `serving ${tools.length} tools (${mode}) for ${config.baseUrl}` +
      `${config.defaultProject ? `, default project ${config.defaultProject}` : ""}`,
  );
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
