import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentCatalogEntry } from "@browser-acp/shared-types";
import type { DebugLogger } from "../debug/logger.js";

export async function loadUserEntries(rootDir: string, logger?: DebugLogger): Promise<AgentCatalogEntry[]> {
  const configPath = join(rootDir, "agents.json");
  if (!existsSync(configPath)) {
    logger?.log("catalog", "no user agent config found", {
      configPath,
    });
    return [];
  }

  const raw = await readFile(configPath, "utf8");
  const entries = JSON.parse(raw) as AgentCatalogEntry[];
  logger?.log("catalog", "loaded user agent config", {
    configPath,
    count: entries.length,
  });
  return entries;
}
