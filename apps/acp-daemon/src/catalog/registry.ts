import type { AgentCatalogEntry, AgentDistribution } from "@browser-acp/shared-types";
import type { DebugLogger } from "../debug/logger.js";

interface RegistryAgent {
  id: string;
  name: string;
  version?: string;
  description?: string;
  website?: string;
  repository?: string;
  icon?: string;
  distribution?: {
    npx?: {
      package: string;
      args?: string[];
    };
    binary?: Record<string, { cmd: string }>;
  };
}

interface RegistryPayload {
  agents: RegistryAgent[];
}

const SUPPORTED_AGENT_IDS = new Set([
  "gemini-cli",
  "github-copilot-cli",
  "qoder-cli",
  "codex-cli",
  "claude-agent",
]);

export async function fetchRegistryEntries(
  fetchImpl: typeof fetch = fetch,
  logger?: DebugLogger,
): Promise<AgentCatalogEntry[]> {
  logger?.log("catalog", "fetching ACP registry", {
    url: "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
  });
  const response = await fetchImpl("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json");
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${response.status}`);
  }

  const payload = (await response.json()) as RegistryPayload;
  const entries = payload.agents
    .filter((agent) => SUPPORTED_AGENT_IDS.has(agent.id))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      website: agent.website,
      repository: agent.repository,
      icon: agent.icon,
      source: "registry" as const,
      distribution: mapDistribution(agent),
    }));
  logger?.log("catalog", "ACP registry loaded", {
    count: entries.length,
    ids: entries.map((entry) => entry.id),
  });
  return entries;
}

function mapDistribution(agent: RegistryAgent): AgentDistribution {
  if (agent.distribution?.npx) {
    return {
      type: "npx",
      command: "npx",
      args: [agent.distribution.npx.package, ...(agent.distribution.npx.args ?? [])],
      packageName: agent.distribution.npx.package,
    };
  }

  const binary = agent.distribution?.binary ? Object.values(agent.distribution.binary)[0] : undefined;
  if (binary) {
    return {
      type: "binary",
      command: binary.cmd,
    };
  }

  return {
    type: "custom",
    command: agent.name,
  };
}
