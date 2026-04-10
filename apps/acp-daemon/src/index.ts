import { mkdir } from "node:fs/promises";
import { BROWSER_ACP_APP_SUPPORT_DIR_NAME } from "@browser-acp/config";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDebugLogger } from "./debug/logger.js";
import { createAgentCatalogService } from "./catalog/service.js";
import { createDaemonApp } from "./server.js";

export { createDaemonApp } from "./server.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  const rootDir = options.rootDir ?? join(homedir(), "Library", "Application Support", BROWSER_ACP_APP_SUPPORT_DIR_NAME);

  await mkdir(rootDir, { recursive: true });
  const logger = createDebugLogger();

  const app = createDaemonApp({
    token: options.token ?? "",
    port: options.port ?? 0,
    rootDir,
    defaultCwd: options.cwd ?? process.cwd(),
    listAgents: createAgentCatalogService(rootDir, logger),
    logger,
  });

  const started = await app.start();
  process.stdout.write(JSON.stringify({ port: started.port }) + "\n");

  const stop = async () => {
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
}

function parseCliArgs(argv: string[]): {
  port?: number;
  token?: string;
  rootDir?: string;
  cwd?: string;
} {
  const options: {
    port?: number;
    token?: string;
    rootDir?: string;
    cwd?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!value) {
      continue;
    }

    if (key === "--port") {
      options.port = Number(value);
      index += 1;
      continue;
    }

    if (key === "--token") {
      options.token = value;
      index += 1;
      continue;
    }

    if (key === "--rootDir") {
      options.rootDir = value;
      index += 1;
      continue;
    }

    if (key === "--cwd") {
      options.cwd = value;
      index += 1;
    }
  }

  return options;
}
