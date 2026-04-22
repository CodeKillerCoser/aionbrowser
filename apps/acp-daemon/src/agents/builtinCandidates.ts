import type { AgentSpec, AgentSpecCandidate } from "@browser-acp/shared-types";
import {
  buildResolvedCatalog,
  getBuiltinRegistryDefaults,
  getDiscoveryCommandCandidates,
} from "../catalog/index.js";
import { scanAvailableCommands } from "../catalog/discovery.js";
import type { DebugLogger } from "../debug/logger.js";

interface BuildBuiltinAgentSpecCandidatesInput {
  availableCommands: Set<string>;
  commandPaths?: Map<string, string>;
  configuredSpecs: AgentSpec[];
}

interface ScanBuiltinAgentSpecCandidatesInput {
  configuredSpecs: AgentSpec[];
  env?: NodeJS.ProcessEnv;
  logger?: DebugLogger;
}

export async function scanBuiltinAgentSpecCandidates({
  configuredSpecs,
  env,
  logger,
}: ScanBuiltinAgentSpecCandidatesInput): Promise<AgentSpecCandidate[]> {
  const registryEntries = getBuiltinRegistryDefaults();
  const discovery = await scanAvailableCommands(
    getDiscoveryCommandCandidates({
      registryEntries,
      userEntries: [],
    }),
    {
      env,
      logger,
    },
  );

  return buildBuiltinAgentSpecCandidates({
    availableCommands: discovery.commands,
    commandPaths: discovery.commandPaths,
    configuredSpecs,
  });
}

export function buildBuiltinAgentSpecCandidates({
  availableCommands,
  commandPaths = new Map(),
  configuredSpecs,
}: BuildBuiltinAgentSpecCandidatesInput): AgentSpecCandidate[] {
  const catalog = buildResolvedCatalog({
    registryEntries: getBuiltinRegistryDefaults(),
    userEntries: [],
    availableCommands,
    commandPaths,
  });
  const configuredLaunches = new Set(
    configuredSpecs
      .filter((spec) => spec.kind === "external-acp")
      .map((spec) => normalizeLaunch(spec.launch.command, spec.launch.args)),
  );

  return catalog
    .filter((agent) => agent.status === "ready" || agent.status === "launchable")
    .filter((agent) => !configuredLaunches.has(normalizeLaunch(agent.launchCommand, agent.launchArgs)))
    .map((agent) => ({
      catalogId: agent.id,
      name: agent.name,
      description: agent.description,
      icon: agent.icon
        ? {
            kind: "url" as const,
            value: agent.icon,
          }
        : undefined,
      launchCommand: agent.launchCommand,
      launchArgs: agent.launchArgs,
      detectedCommandPath: agent.detectedCommandPath,
      status: agent.status,
      recommended: agent.status === "ready" || agent.status === "launchable",
      installationHint: agent.installationHint,
    }));
}

function normalizeLaunch(command: string, args: string[]): string {
  return [command.trim(), ...args.map((arg) => arg.trim())].join("\u0000");
}
