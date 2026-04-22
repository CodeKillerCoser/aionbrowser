import type { ResolvedAgent } from "@browser-acp/shared-types";
import type { DebugLogger } from "../debug/logger.js";
import { AgentSpecStore } from "../agents/configStore.js";
import { createAgentRegistry } from "../agents/registry.js";

export function createAgentCatalogService(rootDir: string, logger?: DebugLogger): () => Promise<ResolvedAgent[]> {
  const registry = createAgentRegistry(new AgentSpecStore(rootDir));

  return async function listAgents() {
    const entries = await registry.listAgents();
    logger?.log("catalog", "agent catalog loaded from configured agent specs", {
      rootDir,
      count: entries.length,
    });
    return entries;
  };
}
