import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@browser-acp/shared-types";
import {
  PENDING_SESSION_ID,
  addOptimisticPrompt,
  buildThreadMessages,
  createOptimisticPromptId,
  markOptimisticPromptFailed,
  mergeOptimisticPrompts,
  moveOptimisticPromptToSession,
  updateOptimisticPromptContext,
  type OptimisticPrompt,
} from "../src/index.js";

describe("mergeOptimisticPrompts", () => {
  it("creates recognizable optimistic prompt ids", () => {
    expect(createOptimisticPromptId()).toMatch(/^optimistic-\d+-[a-z0-9]+$/);
  });

  it("exposes the shared pending session id", () => {
    expect(PENDING_SESSION_ID).toBe("pending-session");
  });

  it("adds a user message and running assistant placeholder for pending prompts", () => {
    const prompt: OptimisticPrompt = {
      id: "optimistic-1",
      sessionId: "pending-session",
      agentId: "qoder-cli",
      text: "Explain the selected code",
      createdAt: new Date("2026-04-24T00:00:00.000Z"),
    };

    const messages = mergeOptimisticPrompts([], [prompt], "pending-session");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      kind: "message",
      id: "optimistic-1",
      role: "user",
      content: [{ type: "text", text: "Explain the selected code" }],
      status: { type: "complete", reason: "stop" },
    });
    expect(messages[1]).toMatchObject({
      kind: "message",
      id: "optimistic-1-loading",
      role: "assistant",
      status: { type: "running" },
    });
  });

  it("does not duplicate prompts that are already represented by session events", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-1",
        agentId: "qoder-cli",
        prompt: "Explain the selected code",
        startedAt: "2026-04-24T00:00:00.000Z",
      },
    ];
    const prompt: OptimisticPrompt = {
      id: "optimistic-1",
      sessionId: "session-1",
      agentId: "qoder-cli",
      text: "Explain the selected code",
      createdAt: new Date("2026-04-24T00:00:00.000Z"),
    };

    const messages = mergeOptimisticPrompts(buildThreadMessages(events), [prompt], "session-1");

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.id)).toEqual(["user-turn-1", "assistant-turn-1"]);
  });

  it("renders failed optimistic prompts as an assistant error message", () => {
    const prompt: OptimisticPrompt = {
      id: "optimistic-1",
      sessionId: "pending-session",
      agentId: "qoder-cli",
      text: "Explain the selected code",
      createdAt: new Date("2026-04-24T00:00:00.000Z"),
      failureMessage: "Network unavailable",
    };

    const messages = mergeOptimisticPrompts([], [prompt], "pending-session");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      kind: "message",
      id: "optimistic-1-failure",
      role: "assistant",
      content: [{ type: "text", text: "发送失败：Network unavailable" }],
      status: {
        type: "incomplete",
        reason: "error",
        error: "Network unavailable",
      },
    });
  });

  it("adds optimistic prompts with pending session fallback and context", () => {
    const context = {
      tabId: 1,
      url: "https://example.com",
      title: "Example",
      selectionText: "selected",
      summaryMarkdown: "summary",
      openTabsPreview: [],
      capturedAt: "2026-04-26T00:00:00.000Z",
    };

    expect(
      addOptimisticPrompt([], {
        id: "optimistic-1",
        sessionId: "",
        agentId: "agent-1",
        text: " Explain this ",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        context,
      }),
    ).toEqual([
      {
        id: "optimistic-1",
        sessionId: PENDING_SESSION_ID,
        agentId: "agent-1",
        text: "Explain this",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        context,
      },
    ]);
  });

  it("updates optimistic prompt context, session, and failure state by id", () => {
    const originalContext = {
      tabId: 1,
      url: "https://example.com",
      title: "Example",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-26T00:00:00.000Z",
    };
    const nextContext = {
      ...originalContext,
      title: "Updated",
      capturedAt: "2026-04-26T00:00:01.000Z",
    };
    const prompts: OptimisticPrompt[] = [
      {
        id: "optimistic-1",
        sessionId: PENDING_SESSION_ID,
        agentId: "agent-1",
        text: "Explain this",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        context: originalContext,
      },
    ];

    expect(updateOptimisticPromptContext(prompts, "optimistic-1", nextContext)[0]?.context).toBe(nextContext);
    expect(moveOptimisticPromptToSession(prompts, "optimistic-1", "session-1")[0]?.sessionId).toBe("session-1");
    expect(markOptimisticPromptFailed(prompts, "optimistic-1", "Network unavailable")[0]?.failureMessage).toBe(
      "Network unavailable",
    );
  });
});
