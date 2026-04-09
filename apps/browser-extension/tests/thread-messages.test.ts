import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@browser-acp/shared-types";
import { buildThreadMessages } from "../src/sidepanel/threadMessages";

describe("buildThreadMessages", () => {
  it("merges ACP turn deltas into a single assistant message", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "Explain this commit",
        startedAt: "2026-04-08T03:50:30.000Z",
      },
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: "turn-1",
        chunk: "This ",
        role: "agent",
        updateKind: "agent_message_chunk",
      },
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: "turn-1",
        chunk: "is merged.",
        role: "agent",
        updateKind: "agent_message_chunk",
      },
      {
        type: "turn.completed",
        sessionId: "session-1",
        turnId: "turn-1",
        stopReason: "stop",
        completedAt: "2026-04-08T03:50:39.000Z",
      },
    ];

    const messages = buildThreadMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "user-turn-1",
      role: "user",
      content: [{ type: "text", text: "Explain this commit" }],
    });
    expect(messages[1]).toMatchObject({
      id: "assistant-turn-1",
      role: "assistant",
      content: [{ type: "text", text: "This is merged." }],
      status: { type: "complete", reason: "stop" },
    });
  });

  it("keeps an in-progress assistant message while the turn is still streaming", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-2",
        prompt: "What changed?",
        startedAt: "2026-04-08T03:50:30.000Z",
      },
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: "turn-2",
        chunk: "Still streaming",
        role: "agent",
        updateKind: "agent_message_chunk",
      },
    ];

    const messages = buildThreadMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: "assistant-turn-2",
      role: "assistant",
      content: [{ type: "text", text: "Still streaming" }],
      status: { type: "running" },
    });
  });

  it("ignores out-of-band system markers and keeps thought text out of the visible assistant reply", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: null,
        chunk: "",
        role: "system",
        updateKind: "available_commands_update",
      },
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-3",
        prompt: "Who are you?",
        startedAt: "2026-04-08T06:00:50.000Z",
      },
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: "turn-3",
        chunk: "Thinking about it.",
        role: "system",
        updateKind: "agent_thought_chunk",
      },
      {
        type: "turn.delta",
        sessionId: "session-1",
        turnId: "turn-3",
        chunk: "I am Browser ACP.",
        role: "agent",
        updateKind: "agent_message_chunk",
      },
      {
        type: "turn.completed",
        sessionId: "session-1",
        turnId: "turn-3",
        stopReason: "end_turn",
        completedAt: "2026-04-08T06:00:51.000Z",
      },
    ];

    const messages = buildThreadMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "user-turn-3",
      content: [{ type: "text", text: "Who are you?" }],
    });
    expect(messages[1]).toMatchObject({
      id: "assistant-turn-3",
      content: [{ type: "text", text: "I am Browser ACP." }],
      status: { type: "complete", reason: "stop" },
    });
    expect(messages[1]?.metadata?.custom).toMatchObject({
      thought: "Thinking about it.",
    });
  });

  it("creates a placeholder assistant message as soon as a turn starts", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-4",
        prompt: "Start thinking",
        startedAt: "2026-04-08T06:02:00.000Z",
      },
    ];

    const messages = buildThreadMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: "assistant-turn-4",
      role: "assistant",
      content: [],
      status: { type: "running" },
    });
  });
});
