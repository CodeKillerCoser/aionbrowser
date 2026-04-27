import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@browser-acp/shared-types";
import type { OptimisticPrompt } from "../src/index.js";
import {
  appendSessionEvent,
  filterOptimisticPromptsByStartedTurns,
  filterSubmittingPermissionIdsByResolvedEvents,
  getSessionEvents,
  markPermissionSubmitting,
} from "../src/index.js";

describe("session event state helpers", () => {
  it("reads and appends events by session without mutating existing state", () => {
    const event: SessionEvent = {
      type: "turn.completed",
      sessionId: "session-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      completedAt: "2026-04-26T00:00:00.000Z",
    };
    const current = { "session-1": [] as SessionEvent[] };

    const next = appendSessionEvent(current, "session-1", event);

    expect(getSessionEvents(next, "session-1")).toEqual([event]);
    expect(getSessionEvents(next, "missing")).toEqual([]);
    expect(current["session-1"]).toEqual([]);
  });

  it("removes optimistic prompts once matching turn.started events arrive", () => {
    const prompts: OptimisticPrompt[] = [
      {
        id: "prompt-1",
        sessionId: "session-1",
        agentId: "agent-1",
        text: "Explain this",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
      },
      {
        id: "prompt-2",
        sessionId: "session-2",
        agentId: "agent-1",
        text: "Explain this",
        createdAt: new Date("2026-04-26T00:00:01.000Z"),
      },
    ];
    const events: SessionEvent[] = [
      {
        type: "turn.started",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: " Explain this ",
        startedAt: "2026-04-26T00:00:02.000Z",
      },
    ];

    expect(filterOptimisticPromptsByStartedTurns(prompts, "session-1", events)).toEqual([prompts[1]]);
  });

  it("removes submitting permission ids once resolved events arrive", () => {
    const events: SessionEvent[] = [
      {
        type: "permission.resolved",
        sessionId: "session-1",
        turnId: "turn-1",
        permissionId: "permission-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        toolCallId: "tool-1",
        outcome: "selected",
      },
    ];

    expect(filterSubmittingPermissionIdsByResolvedEvents(["permission-1", "permission-2"], events)).toEqual([
      "permission-2",
    ]);
  });

  it("marks submitting permission ids without duplicates", () => {
    expect(markPermissionSubmitting(["permission-1"], "permission-1")).toEqual(["permission-1"]);
    expect(markPermissionSubmitting(["permission-1"], "permission-2")).toEqual(["permission-1", "permission-2"]);
  });
});
