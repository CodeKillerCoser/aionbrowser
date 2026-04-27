import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@browser-acp/shared-types";
import type { OptimisticPrompt } from "@browser-acp/client-core";
import { useTranscriptHousekeeping } from "../src/ui/sidepanel/hooks/useTranscriptHousekeeping";

describe("useTranscriptHousekeeping", () => {
  it("removes optimistic prompts that have started and clears resolved permission submissions", () => {
    const startedEvent: SessionEvent = {
      type: "turn.started",
      sessionId: "session-1",
      turnId: "turn-1",
      prompt: "Hello",
      startedAt: "2026-04-20T01:00:00.000Z",
    };
    const resolvedPermissionEvent: SessionEvent = {
      type: "permission.resolved",
      sessionId: "session-1",
      turnId: "turn-1",
      permissionId: "permission-1",
      createdAt: "2026-04-20T01:00:01.000Z",
      toolCallId: "tool-1",
      outcome: "selected",
    };
    const optimisticPrompt: OptimisticPrompt = {
      id: "optimistic-1",
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Hello",
      createdAt: new Date("2026-04-20T01:00:00.000Z"),
      context: {
        tabId: 1,
        url: "https://example.com",
        title: "Example",
        selectionText: "",
        summaryMarkdown: "",
        openTabsPreview: [],
        capturedAt: "2026-04-20T01:00:00.000Z",
      },
    };

    const { result } = renderHook(() => {
      const [optimisticPrompts, setOptimisticPrompts] = useState([optimisticPrompt]);
      const [submittingPermissionIds, setSubmittingPermissionIds] = useState(["permission-1"]);
      const [currentEvents, setCurrentEvents] = useState<SessionEvent[]>([]);

      useTranscriptHousekeeping({
        currentEvents,
        selectedSessionId: "session-1",
        setOptimisticPrompts,
        setSubmittingPermissionIds,
      });

      return {
        optimisticPrompts,
        submittingPermissionIds,
        setCurrentEvents,
      };
    });

    act(() => {
      result.current.setCurrentEvents([startedEvent, resolvedPermissionEvent]);
    });

    expect(result.current.optimisticPrompts).toEqual([]);
    expect(result.current.submittingPermissionIds).toEqual([]);
  });
});
