import type {
  AgentCatalogEntry,
  AgentSpec,
  ResolvedAgent,
} from "@browser-acp/shared-types";

export interface AgentSpecRepository {
  list(): Promise<AgentSpec[]>;
}

export interface AgentRegistry {
  listSpecs(): Promise<AgentSpec[]>;
  listAgents(): Promise<ResolvedAgent[]>;
  resolveAgent(agentId: string): Promise<ResolvedAgent | null>;
}

export function createAgentRegistry(store: AgentSpecRepository): AgentRegistry {
  return {
    listSpecs: () => store.list(),
    async listAgents() {
      return (await store.list())
        .filter((spec) => spec.enabled)
        .map(specToResolvedAgent);
    },
    async resolveAgent(agentId) {
      return (await this.listAgents()).find((agent) => agent.id === agentId) ?? null;
    },
  };
}

export function specToResolvedAgent(spec: AgentSpec): ResolvedAgent {
  if (spec.kind === "external-acp") {
    const entry: AgentCatalogEntry = {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      icon: spec.icon?.value,
      source: "user",
      distribution: {
        type: "custom",
        command: spec.launch.command,
        args: spec.launch.args,
      },
    };

    return {
      ...entry,
      status: "launchable",
      launchCommand: spec.launch.command,
      launchArgs: spec.launch.args,
    };
  }

  const entry: AgentCatalogEntry = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    icon: spec.icon?.value,
    source: "user",
    distribution: {
      type: "custom",
      command: spec.name,
      args: [],
    },
  };

  return {
    ...entry,
    status: "launchable",
    launchCommand: spec.name,
    launchArgs: [],
  };
}
