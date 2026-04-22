import { basename } from "node:path";
import type { AgentCatalogEntry, AgentStatus, ResolvedAgent } from "@browser-acp/shared-types";

interface ResolutionRule {
  localCommands: string[];
  localArgs: string[];
  adapterCommands?: string[];
  adapterPackage?: string;
  baseCliCommands?: string[];
}

interface BuildResolvedCatalogInput {
  registryEntries: AgentCatalogEntry[];
  userEntries: AgentCatalogEntry[];
  availableCommands: Set<string>;
  commandPaths?: Map<string, string>;
}

const BUILTIN_REGISTRY_DEFAULTS: AgentCatalogEntry[] = [
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's official CLI for Gemini",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@google/gemini-cli", "--experimental-acp"],
      packageName: "@google/gemini-cli",
    },
    repository: "https://github.com/google-gemini/gemini-cli",
    website: "https://geminicli.com",
  },
  {
    id: "github-copilot-cli",
    name: "GitHub Copilot",
    description: "GitHub's AI pair programmer",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@github/copilot", "--acp"],
      packageName: "@github/copilot",
    },
    repository: "https://github.com/github/copilot-cli",
  },
  {
    id: "qoder-cli",
    name: "Qoder CLI",
    description: "AI coding assistant with agentic capabilities",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@qoder-ai/qodercli", "--acp"],
      packageName: "@qoder-ai/qodercli",
    },
    website: "https://qoder.com",
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "ACP adapter for OpenAI's coding assistant",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@zed-industries/codex-acp"],
      packageName: "@zed-industries/codex-acp",
    },
    repository: "https://github.com/zed-industries/codex-acp",
  },
  {
    id: "claude-agent",
    name: "Claude Agent",
    description: "ACP wrapper for Anthropic's Claude",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@agentclientprotocol/claude-agent-acp"],
      packageName: "@agentclientprotocol/claude-agent-acp",
    },
    repository: "https://github.com/agentclientprotocol/claude-agent-acp",
  },
];

export function getBuiltinRegistryDefaults(): AgentCatalogEntry[] {
  return BUILTIN_REGISTRY_DEFAULTS.map((entry) => ({
    ...entry,
    distribution: {
      ...entry.distribution,
      args: entry.distribution.args ? [...entry.distribution.args] : undefined,
    },
  }));
}

const RESOLUTION_RULES: Record<string, ResolutionRule> = {
  "gemini-cli": {
    localCommands: ["gemini"],
    localArgs: ["--experimental-acp"],
  },
  "github-copilot-cli": {
    localCommands: ["github-copilot", "copilot"],
    localArgs: ["--acp"],
  },
  "qoder-cli": {
    localCommands: ["qodercli"],
    localArgs: ["--acp"],
  },
  "codex-cli": {
    localCommands: ["codex-acp"],
    localArgs: [],
    adapterCommands: ["codex-acp"],
    adapterPackage: "@zed-industries/codex-acp",
    baseCliCommands: ["codex"],
  },
  "claude-agent": {
    localCommands: ["claude-agent-acp", "claude-code-acp"],
    localArgs: [],
    adapterCommands: ["claude-agent-acp", "claude-code-acp"],
    adapterPackage: "@agentclientprotocol/claude-agent-acp",
    baseCliCommands: ["claude", "claude-code"],
  },
};

export function buildResolvedCatalog({
  registryEntries,
  userEntries,
  availableCommands,
  commandPaths = new Map(),
}: BuildResolvedCatalogInput): ResolvedAgent[] {
  const merged = mergeCatalogEntries(registryEntries, userEntries);

  return [...merged.values()].map((entry) =>
    resolveEntry(entry, availableCommands, commandPaths, userEntries.some((candidate) => candidate.id === entry.id)),
  );
}

export function getDiscoveryCommandCandidates({
  registryEntries,
  userEntries,
}: Pick<BuildResolvedCatalogInput, "registryEntries" | "userEntries">): string[] {
  const merged = mergeCatalogEntries(registryEntries, userEntries);
  const candidates = new Set<string>(["npx"]);

  for (const entry of merged.values()) {
    candidates.add(basename(entry.distribution.command));

    const rule = RESOLUTION_RULES[entry.id];
    if (!rule) {
      continue;
    }

    rule.localCommands.forEach((command) => candidates.add(command));
    rule.adapterCommands?.forEach((command) => candidates.add(command));
    rule.baseCliCommands?.forEach((command) => candidates.add(command));
  }

  return [...candidates].filter((entry) => entry.length > 0);
}

function mergeCatalogEntries(
  registryEntries: AgentCatalogEntry[],
  userEntries: AgentCatalogEntry[],
): Map<string, AgentCatalogEntry> {
  const merged = new Map<string, AgentCatalogEntry>();

  for (const entry of BUILTIN_REGISTRY_DEFAULTS) {
    merged.set(entry.id, entry);
  }

  for (const entry of registryEntries) {
    merged.set(entry.id, {
      ...merged.get(entry.id),
      ...entry,
      distribution: entry.distribution ?? merged.get(entry.id)?.distribution ?? {
        type: "custom",
        command: entry.name,
      },
    });
  }

  for (const entry of userEntries) {
    merged.set(entry.id, entry);
  }

  return merged;
}

function resolveEntry(
  entry: AgentCatalogEntry,
  availableCommands: Set<string>,
  commandPaths: Map<string, string>,
  isUserConfigured: boolean,
): ResolvedAgent {
  if (isUserConfigured || entry.source === "user") {
    return resolveUserEntry(entry, availableCommands, commandPaths);
  }

  const rule = RESOLUTION_RULES[entry.id];
  const npxAvailable = availableCommands.has("npx");

  if (!rule) {
    return finalizeResolvedEntry(entry, "launchable", entry.distribution.command, entry.distribution.args ?? []);
  }

  const matchedLocalCommand = rule.localCommands.find((candidate) =>
    availableCommands.has(candidate),
  );

  if (matchedLocalCommand) {
    return finalizeResolvedEntry(
      entry,
      "ready",
      matchedLocalCommand,
      rule.localArgs,
      undefined,
      undefined,
      commandPaths.get(matchedLocalCommand),
    );
  }

  const hasBaseCliOnly =
    rule.baseCliCommands?.some((candidate) => availableCommands.has(candidate)) ?? false;

  if (hasBaseCliOnly && rule.adapterPackage) {
    return finalizeResolvedEntry(
      entry,
      "needs_adapter",
      entry.distribution.command,
      entry.distribution.args ?? [],
      `Install the ACP adapter package ${rule.adapterPackage} to use ${entry.name}.`,
      rule.adapterPackage,
    );
  }

  if (npxAvailable) {
    return finalizeResolvedEntry(
      entry,
      "launchable",
      entry.distribution.command,
      entry.distribution.args ?? [],
      entry.distribution.packageName
        ? `Can be launched via npx using ${entry.distribution.packageName}.`
        : undefined,
      rule.adapterPackage,
      commandPaths.get(entry.distribution.command),
    );
  }

  return finalizeResolvedEntry(
    entry,
    "unavailable",
    entry.distribution.command,
    entry.distribution.args ?? [],
    "No compatible local command was found and npx is unavailable.",
    rule.adapterPackage,
    commandPaths.get(entry.distribution.command),
  );
}

function resolveUserEntry(
  entry: AgentCatalogEntry,
  availableCommands: Set<string>,
  commandPaths: Map<string, string>,
): ResolvedAgent {
  const commandName = basename(entry.distribution.command);
  const isAbsolute = entry.distribution.command.startsWith("/");
  const isReady = isAbsolute || availableCommands.has(commandName);

  return finalizeResolvedEntry(
    entry,
    isReady ? "ready" : "unavailable",
    entry.distribution.command,
    entry.distribution.args ?? [],
    isReady ? undefined : `Custom command ${entry.distribution.command} is not available on this machine.`,
    undefined,
    isAbsolute ? entry.distribution.command : commandPaths.get(commandName),
  );
}

function finalizeResolvedEntry(
  entry: AgentCatalogEntry,
  status: AgentStatus,
  launchCommand: string,
  launchArgs: string[],
  installationHint?: string,
  adapterPackage?: string,
  detectedCommandPath?: string,
): ResolvedAgent {
  return {
    ...entry,
    status,
    launchCommand,
    launchArgs,
    installationHint,
    adapterPackage,
    detectedCommand: status === "ready" ? launchCommand : undefined,
    detectedCommandPath,
  };
}
