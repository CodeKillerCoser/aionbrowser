import type { ConversationSummary, ResolvedAgent } from "@browser-acp/shared-types";
import type { TranscriptItem } from "./threadMessages.js";

export function findSelectedSession(
  sessions: ConversationSummary[],
  selectedSessionId: string,
): ConversationSummary | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? null;
}

export function findActiveAgent(
  agents: ResolvedAgent[],
  selectedSession: ConversationSummary | null,
  selectedAgentId: string,
): ResolvedAgent | null {
  const activeAgentId = selectedSession?.agentId ?? selectedAgentId;
  return agents.find((agent) => agent.id === activeAgentId) ?? null;
}

export function getConversationTitle(selectedSession: ConversationSummary | null): string {
  return selectedSession?.title ?? "新对话";
}

export function getConversationAgentName(activeAgent: ResolvedAgent | null): string {
  return activeAgent?.name ?? "未选择智能体";
}

export function upsertConversationSummary(
  sessions: ConversationSummary[],
  summary: ConversationSummary,
): ConversationSummary[] {
  return [summary, ...sessions.filter((entry) => entry.id !== summary.id)];
}

export function hasRunningAssistantTurn(messages: TranscriptItem[]): boolean {
  return messages.some(
    (message) => message.kind === "message" && message.role === "assistant" && message.status.type === "running",
  );
}
