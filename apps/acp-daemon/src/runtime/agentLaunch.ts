import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ResolvedAgent } from "@browser-acp/shared-types";

interface PrepareAgentLaunchInput {
  agent: ResolvedAgent;
  cwd: string;
}

export interface PreparedAgentLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
  newSessionAdditionalDirectories?: string[];
  newSessionMeta?: Record<string, unknown>;
  newSessionSettings?: Record<string, unknown>;
  promptPrefix?: string;
}

const BROWSER_ACP_RUNTIME_INSTRUCTIONS = [
  "# Browser ACP Runtime Instructions",
  "",
  "You are running as a local CLI agent through Browser ACP.",
  "Use the local tools exposed by your runtime when they are available, including filesystem and shell tools.",
  "Do not claim that you are limited to the current web page or that you cannot access local files unless a tool call actually fails.",
  "If the user asks about local files, inspect them directly with available tools instead of asking the user to open a terminal.",
  "If an operation requires approval, request it through the runtime permission flow and continue after the user decides.",
  "",
  "Browser ACP writes dynamic browser context for each turn to a workspace-local temporary file.",
  "When a user asks about the current page, selected text, URL, tabs, or browser state, read the browser context file path referenced in that turn's user message.",
  "Treat browser context files as per-turn context, not long-term memory.",
  "",
].join("\n");

export async function prepareAgentLaunch(input: PrepareAgentLaunchInput): Promise<PreparedAgentLaunch> {
  const kind = detectAgentKind(input.agent);
  if (!kind) {
    return {
      command: input.agent.launchCommand,
      args: [...input.agent.launchArgs],
    };
  }

  const instructionRoot = join(input.cwd, ".browser-acp", "tmp", "agent-instructions", kind);
  await mkdir(instructionRoot, { recursive: true });

  if (kind === "gemini") {
    const contextFile = join(instructionRoot, "GEMINI.md");
    const settingsFile = join(instructionRoot, "system-settings.json");
    await writeFile(contextFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
    await writeJsonFile(settingsFile, {
      context: {
        includeDirectories: [instructionRoot],
        loadMemoryFromIncludeDirectories: true,
      },
    });
    return {
      command: input.agent.launchCommand,
      args: injectCliArgs(input.agent.launchCommand, input.agent.launchArgs, [
        "--include-directories",
        instructionRoot,
      ]),
      env: {
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile,
      },
    };
  }

  if (kind === "qwen") {
    const contextFile = join(instructionRoot, "QWEN.md");
    const settingsFile = join(instructionRoot, "system-settings.json");
    await writeFile(contextFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
    await writeJsonFile(settingsFile, {
      context: {
        includeDirectories: [instructionRoot],
        loadFromIncludeDirectories: true,
      },
    });
    return {
      command: input.agent.launchCommand,
      args: injectCliArgs(input.agent.launchCommand, input.agent.launchArgs, [
        "--include-directories",
        instructionRoot,
      ]),
      env: {
        QWEN_CODE_SYSTEM_SETTINGS_PATH: settingsFile,
      },
      newSessionSettings: {
        add_dirs: [instructionRoot],
        append_system_prompt: BROWSER_ACP_RUNTIME_INSTRUCTIONS,
      },
    };
  }

  if (kind === "qoder") {
    const instructionsFile = join(instructionRoot, "browser-acp-instructions.md");
    await writeFile(instructionsFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
    return {
      command: input.agent.launchCommand,
      args: [...input.agent.launchArgs],
      promptPrefix: BROWSER_ACP_RUNTIME_INSTRUCTIONS,
    };
  }

  if (kind === "codex") {
    const instructionsFile = join(instructionRoot, "AGENTS.md");
    await writeFile(instructionsFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
    return {
      command: input.agent.launchCommand,
      args: injectCliArgs(input.agent.launchCommand, input.agent.launchArgs, [
        "-c",
        `model_instructions_file=${JSON.stringify(instructionsFile)}`,
      ]),
    };
  }

  if (kind === "claude-acp") {
    const instructionsFile = join(instructionRoot, "browser-acp-instructions.md");
    await writeFile(instructionsFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
    return {
      command: input.agent.launchCommand,
      args: [...input.agent.launchArgs],
      newSessionMeta: {
        systemPrompt: {
          append: BROWSER_ACP_RUNTIME_INSTRUCTIONS,
        },
      },
    };
  }

  const instructionsFile = join(instructionRoot, "browser-acp-instructions.md");
  await writeFile(instructionsFile, BROWSER_ACP_RUNTIME_INSTRUCTIONS, "utf8");
  return {
    command: input.agent.launchCommand,
    args: injectCliArgs(input.agent.launchCommand, input.agent.launchArgs, [
      "--append-system-prompt-file",
      instructionsFile,
    ]),
  };
}

type AgentKind = "gemini" | "qwen" | "qoder" | "codex" | "claude" | "claude-acp";

function detectAgentKind(agent: ResolvedAgent): AgentKind | null {
  if (isClaudeAcpAdapter(agent)) {
    return "claude-acp";
  }

  const haystack = [
    agent.id,
    agent.name,
    agent.launchCommand,
    ...agent.launchArgs,
    agent.distribution.command,
    ...(agent.distribution.args ?? []),
    agent.adapterPackage ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("gemini")) {
    return "gemini";
  }
  if (haystack.includes("qwen")) {
    return "qwen";
  }
  if (haystack.includes("qoder")) {
    return "qoder";
  }
  if (haystack.includes("codex") || haystack.includes("@openai/codex")) {
    return "codex";
  }
  if (haystack.includes("claude")) {
    return "claude";
  }
  return null;
}

function isClaudeAcpAdapter(agent: ResolvedAgent): boolean {
  const commandName = basename(agent.launchCommand);
  const packageName = agent.launchArgs[0] ?? "";
  return (
    commandName === "claude-agent-acp" ||
    commandName === "claude-code-acp" ||
    packageName.includes("claude-agent-acp") ||
    packageName.includes("claude-code-acp") ||
    Boolean(agent.adapterPackage?.includes("claude-agent-acp")) ||
    Boolean(agent.adapterPackage?.includes("claude-code-acp")) ||
    Boolean(agent.distribution.packageName?.includes("claude-agent-acp")) ||
    Boolean(agent.distribution.packageName?.includes("claude-code-acp"))
  );
}

function injectCliArgs(command: string, args: string[], injectedArgs: string[]): string[] {
  const commandName = basename(command);
  if (commandName === "npx" && args.length > 0) {
    return [args[0], ...injectedArgs, ...args.slice(1)];
  }
  return [...injectedArgs, ...args];
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
