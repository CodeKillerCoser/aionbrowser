import type { AgentSpec, AgentSpecCandidate, ResolvedAgent } from "@browser-acp/shared-types";
import claudeIcon from "../../sidepanel/agent-icons/claude.svg";
import codexIcon from "../../sidepanel/agent-icons/codex.svg";
import geminiIcon from "../../sidepanel/agent-icons/gemini.svg";
import githubCopilotIcon from "../../sidepanel/agent-icons/github-copilot.svg";
import qoderIcon from "../../sidepanel/agent-icons/qoder.svg";

const AGENT_ICON_MAP: Record<string, string> = {
  "claude-agent": claudeIcon,
  "codex-cli": codexIcon,
  "gemini-cli": geminiIcon,
  "github-copilot-cli": githubCopilotIcon,
  "qoder-cli": qoderIcon,
};

const AGENT_NAME_ICON_MATCHERS: Array<[RegExp, string]> = [
  [/github\s+copilot|copilot/i, githubCopilotIcon],
  [/claude/i, claudeIcon],
  [/codex/i, codexIcon],
  [/gemini/i, geminiIcon],
  [/qoder/i, qoderIcon],
];

const AGENT_COMMAND_ICON_MATCHERS: Array<[RegExp, string]> = [
  [/github-copilot|copilot/i, githubCopilotIcon],
  [/claude/i, claudeIcon],
  [/codex/i, codexIcon],
  [/gemini|npx\s+@google\/gemini-cli/i, geminiIcon],
  [/qoder/i, qoderIcon],
];

function resolveBuiltinAgentIcon(name: string, launchCommand?: string): string | undefined {
  const matchedName = AGENT_NAME_ICON_MATCHERS.find(([pattern]) => pattern.test(name));
  if (matchedName) {
    return matchedName[1];
  }

  const matchedCommand = AGENT_COMMAND_ICON_MATCHERS.find(([pattern]) => pattern.test(launchCommand ?? ""));
  return matchedCommand?.[1];
}

export function resolveAgentIcon(agent: ResolvedAgent): string | undefined {
  return agent.icon ?? AGENT_ICON_MAP[agent.id] ?? resolveBuiltinAgentIcon(agent.name, agent.launchCommand);
}

export function resolveSpecIcon(spec: AgentSpec): string | undefined {
  if (spec.icon?.value) {
    return spec.icon.value;
  }

  if (spec.kind === "external-acp") {
    return resolveBuiltinAgentIcon(spec.name, spec.launch.command);
  }

  return resolveBuiltinAgentIcon(spec.name);
}

export function resolveCandidateIcon(candidate: AgentSpecCandidate): string | undefined {
  return (
    candidate.icon?.value ??
    AGENT_ICON_MAP[candidate.catalogId] ??
    resolveBuiltinAgentIcon(candidate.name, candidate.launchCommand)
  );
}
