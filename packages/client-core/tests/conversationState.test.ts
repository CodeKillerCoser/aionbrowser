import { describe, expect, it } from "vitest";
import type { ConversationSummary, ResolvedAgent } from "@browser-acp/shared-types";
import type { TranscriptItem } from "../src/index.js";
import {
  findActiveAgent,
  findSelectedSession,
  getConversationAgentName,
  getConversationTitle,
  hasRunningAssistantTurn,
  upsertConversationSummary,
} from "../src/index.js";

describe("conversation state selectors", () => {
  const sessions: ConversationSummary[] = [
    {
      id: "session-1",
      agentId: "agent-1",
      agentName: "Codex",
      title: "Existing chat",
      pageTitle: "Page",
      pageUrl: "https://example.com",
      lastActivityAt: "2026-04-26T00:00:00.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      active: true,
      readOnly: false,
    },
  ];
  const agents: ResolvedAgent[] = [
    {
      id: "agent-1",
      name: "Codex",
      source: "registry",
      distribution: { type: "binary", command: "codex" },
      status: "ready",
      launchCommand: "codex",
      launchArgs: [],
    },
  ];

  it("finds selected sessions and active agents", () => {
    const selectedSession = findSelectedSession(sessions, "session-1");

    expect(selectedSession).toBe(sessions[0]);
    expect(findSelectedSession(sessions, "missing")).toBeNull();
    expect(findActiveAgent(agents, selectedSession, "fallback")).toBe(agents[0]);
    expect(findActiveAgent(agents, null, "agent-1")).toBe(agents[0]);
  });

  it("provides conversation title and agent name fallbacks", () => {
    expect(getConversationTitle(sessions[0])).toBe("Existing chat");
    expect(getConversationTitle(null)).toBe("新对话");
    expect(getConversationAgentName(agents[0])).toBe("Codex");
    expect(getConversationAgentName(null)).toBe("未选择智能体");
  });

  it("detects running assistant message turns", () => {
    const messages: TranscriptItem[] = [
      {
        kind: "message",
        id: "assistant-loading",
        role: "assistant",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        content: [],
        status: { type: "running" },
      },
    ];

    expect(hasRunningAssistantTurn(messages)).toBe(true);
    expect(hasRunningAssistantTurn([])).toBe(false);
  });

  it("upserts conversation summaries at the front without mutating the current list", () => {
    const updated = {
      ...sessions[0],
      title: "Updated chat",
      lastActivityAt: "2026-04-26T01:00:00.000Z",
    };
    const next = upsertConversationSummary(sessions, updated);

    expect(next).toEqual([updated]);
    expect(sessions[0]?.title).toBe("Existing chat");
  });
});
