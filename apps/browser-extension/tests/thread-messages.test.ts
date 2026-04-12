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

    const items = buildThreadMessages(events);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "message",
      id: "user-turn-1",
      role: "user",
      content: [{ type: "text", text: "Explain this commit" }],
    });
    expect(items[1]).toMatchObject({
      kind: "message",
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

    const items = buildThreadMessages(events);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      kind: "message",
      id: "assistant-turn-2",
      role: "assistant",
      content: [{ type: "text", text: "Still streaming" }],
      status: { type: "running" },
    });
  });

  it("renders thought text as a dedicated system row while keeping the assistant reply clean", () => {
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

    const items = buildThreadMessages(events);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      kind: "message",
      id: "user-turn-3",
      content: [{ type: "text", text: "Who are you?" }],
    });
    expect(items[1]).toMatchObject({
      kind: "system",
      systemType: "thought",
      id: "thought-turn-3",
      text: "Thinking about it.",
      status: "complete",
    });
    expect(items[2]).toMatchObject({
      kind: "message",
      id: "assistant-turn-3",
      content: [{ type: "text", text: "I am Browser ACP." }],
      status: { type: "complete", reason: "stop" },
      metadata: {
        thought: "Thinking about it.",
      },
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

    const items = buildThreadMessages(events);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      kind: "message",
      id: "assistant-turn-4",
      role: "assistant",
      content: [],
      status: { type: "running" },
    });
  });

  it("aggregates tool calls and permission events into dedicated system rows", () => {
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-5",
        prompt: "Read config",
        startedAt: "2026-04-08T06:03:00.000Z",
      },
      {
        type: "tool.call",
        sessionId: "session-1",
        turnId: "turn-5",
        createdAt: "2026-04-08T06:03:01.000Z",
        toolCall: {
          toolCallId: "tool-1",
          title: "Read package.json",
          kind: "read",
          status: "pending",
          rawInput: {
            path: "package.json",
          },
        },
      },
      {
        type: "permission.requested",
        sessionId: "session-1",
        turnId: "turn-5",
        permissionId: "permission-1",
        createdAt: "2026-04-08T06:03:02.000Z",
        toolCall: {
          toolCallId: "tool-1",
          title: "Read package.json",
          kind: "read",
          status: "pending",
        },
        options: [
          {
            optionId: "allow-once",
            kind: "allow_once",
            name: "Allow once",
          },
        ],
      },
      {
        type: "permission.resolved",
        sessionId: "session-1",
        turnId: "turn-5",
        permissionId: "permission-1",
        createdAt: "2026-04-08T06:03:03.000Z",
        toolCallId: "tool-1",
        outcome: "selected",
        selectedOption: {
          optionId: "allow-once",
          kind: "allow_once",
          name: "Allow once",
        },
      },
      {
        type: "tool.call.update",
        sessionId: "session-1",
        turnId: "turn-5",
        createdAt: "2026-04-08T06:03:04.000Z",
        toolCall: {
          toolCallId: "tool-1",
          status: "completed",
          rawOutput: {
            name: "browser_acp",
          },
        },
      },
    ];

    const items = buildThreadMessages(events);

    expect(items).toHaveLength(4);
    expect(items[1]).toMatchObject({
      kind: "system",
      systemType: "tool",
      toolCall: {
        toolCallId: "tool-1",
        title: "Read package.json",
        kind: "read",
        status: "completed",
        rawOutput: {
          name: "browser_acp",
        },
      },
    });
    expect(items[2]).toMatchObject({
      kind: "system",
      systemType: "permission",
      permissionId: "permission-1",
      outcome: "selected",
      selectedOption: {
        optionId: "allow-once",
        kind: "allow_once",
      },
    });
  });
});
