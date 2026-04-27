import type { AgentIconSpec, AgentSpecCandidate, ExternalAgentSpecInput } from "@browser-acp/shared-types";

export function parseLaunchArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildManualAgentSpecInput({
  name,
  launchCommand,
  launchArgsText,
  iconUrl,
  uploadedIcon,
}: {
  name: string;
  launchCommand: string;
  launchArgsText: string;
  iconUrl: string;
  uploadedIcon: AgentIconSpec | null;
}): ExternalAgentSpecInput {
  const trimmedIconUrl = iconUrl.trim();
  const icon = uploadedIcon ?? (trimmedIconUrl ? { kind: "url" as const, value: trimmedIconUrl } : undefined);

  return {
    name: name.trim(),
    launchCommand: launchCommand.trim(),
    launchArgs: parseLaunchArgs(launchArgsText),
    icon,
  };
}

export function canSaveManualAgentSpec({
  hostReady,
  settingsBusy,
  name,
  launchCommand,
}: {
  hostReady: boolean;
  settingsBusy: boolean;
  name: string;
  launchCommand: string;
}): boolean {
  return hostReady && !settingsBusy && name.trim().length > 0 && launchCommand.trim().length > 0;
}

export function buildCandidateAgentSpecInput(candidate: AgentSpecCandidate): ExternalAgentSpecInput {
  return {
    name: candidate.name,
    launchCommand: candidate.launchCommand,
    launchArgs: candidate.launchArgs,
    description: candidate.description,
    icon: candidate.icon,
  };
}

export function buildUploadedAgentIcon(dataUrl: string): AgentIconSpec {
  return {
    kind: "uploaded",
    value: dataUrl,
  };
}

export function collectRecommendedCandidateIds(candidates: AgentSpecCandidate[]): Set<string> {
  return new Set(candidates.filter((candidate) => candidate.recommended).map((candidate) => candidate.catalogId));
}

export function selectAgentSpecCandidates(
  candidates: AgentSpecCandidate[],
  selectedCandidateIds: Set<string>,
): AgentSpecCandidate[] {
  return candidates.filter((candidate) => selectedCandidateIds.has(candidate.catalogId));
}

export function toggleCandidateSelection(
  current: Set<string>,
  candidateId: string,
  checked: boolean,
): Set<string> {
  const next = new Set(current);
  if (checked) {
    next.add(candidateId);
  } else {
    next.delete(candidateId);
  }
  return next;
}

export function getFirstCreatedAgentSpecId(createdSpecs: Array<{ id: string }>): string {
  return createdSpecs[0]?.id ?? "";
}

export function getNextSelectedAgentIdAfterDelete({
  selectedAgentId,
  deletedAgentId,
  nextAgents,
}: {
  selectedAgentId: string;
  deletedAgentId: string;
  nextAgents: Array<{ id: string }>;
}): string {
  return selectedAgentId === deletedAgentId ? nextAgents[0]?.id ?? "" : selectedAgentId;
}

export function formatAgentLocalPath(agent: {
  detectedCommand?: string;
  launchCommand: string;
  launchArgs: string[];
}): string {
  const command = agent.detectedCommand ?? agent.launchCommand;
  const suffix = agent.launchArgs.length > 0 ? ` ${agent.launchArgs.join(" ")}` : "";
  const label = command.startsWith("/") ? "Local path" : "Command";
  return `${label}: ${command}${suffix}`;
}
