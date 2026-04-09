import type { DebugLogger } from "../debug/logger.js";
import { buildResolvedCatalog, getDiscoveryCommandCandidates } from "./index.js";
import { scanAvailableCommands } from "./discovery.js";
import { fetchRegistryEntries } from "./registry.js";
import { loadUserEntries } from "./userConfig.js";

export function createAgentCatalogService(rootDir: string, logger?: DebugLogger) {
  let cache:
    | {
        expiresAt: number;
        entries: Awaited<ReturnType<typeof buildCatalog>>;
      }
    | undefined;

  return async function listAgents() {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      logger?.log("catalog", "agent catalog cache hit", {
        count: cache.entries.length,
        expiresAt: cache.expiresAt,
      });
      return cache.entries;
    }

    logger?.log("catalog", "agent catalog refresh started", {
      rootDir,
    });
    const entries = await buildCatalog(rootDir, logger);
    cache = {
      entries,
      expiresAt: now + 60_000,
    };
    logger?.log("catalog", "agent catalog refresh completed", {
      count: entries.length,
      statuses: countBy(entries.map((entry) => entry.status)),
    });
    return entries;
  };
}

async function buildCatalog(rootDir: string, logger?: DebugLogger) {
  const [registryEntries, userEntries] = await Promise.all([
    fetchRegistryEntries(fetch, logger).catch((error) => {
      logger?.log("catalog", "registry fetch failed; continuing with built-in defaults", error);
      return [];
    }),
    loadUserEntries(rootDir, logger),
  ]);
  const discoveryCandidates = getDiscoveryCommandCandidates({
    registryEntries,
    userEntries,
  });
  logger?.log("catalog", "command discovery candidates prepared", {
    count: discoveryCandidates.length,
    candidates: discoveryCandidates,
    path: process.env.PATH,
  });
  const availableCommands = await scanAvailableCommands(discoveryCandidates, {
    env: process.env,
    logger,
  });
  logger?.log("catalog", "command discovery completed", {
    availableCommands: [...availableCommands],
  });

  return buildResolvedCatalog({
    registryEntries,
    userEntries,
    availableCommands,
  });
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
