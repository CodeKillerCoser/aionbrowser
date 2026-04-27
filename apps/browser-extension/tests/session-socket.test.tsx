import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PermissionDecision, PromptEnvelope, SessionSocketServerMessage } from "@browser-acp/shared-types";
import type { BrowserAcpSocket } from "../src/host-api/agentConsoleHost";
import { useSessionSocket } from "../src/ui/sidepanel/hooks/useSessionSocket";

describe("useSessionSocket", () => {
  it("connects the selected session, appends events, flushes pending work when open, and closes on cleanup", () => {
    const prompt: PromptEnvelope = {
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Hello",
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
    const decision: PermissionDecision = {
      permissionId: "permission-1",
      outcome: "selected",
      optionId: "allow",
    };
    const sendPrompt = vi.fn();
    const resolvePermission = vi.fn();
    const close = vi.fn();
    const socket: BrowserAcpSocket = {
      sendPrompt,
      resolvePermission,
      close,
    };
    let onMessage: ((message: SessionSocketServerMessage) => void) | undefined;
    let onStatus: ((status: "open" | "close" | "error", details?: Record<string, unknown>) => void) | undefined;
    const appendEvent = vi.fn();
    const setError = vi.fn();
    const recordPanelLog = vi.fn();
    const pendingPromptRef = {
      current: prompt,
    };
    const pendingPermissionDecisionsRef = {
      current: [decision],
    };
    const socketRef = {
      current: null as BrowserAcpSocket | null,
    };
    const socketStatusRef = {
      current: "idle" as const,
    };
    const bridge = {
      connectSession: vi.fn((_sessionId, nextOnMessage, _onError, nextOnStatus) => {
        onMessage = nextOnMessage;
        onStatus = nextOnStatus;
        return socket;
      }),
    };

    const { unmount } = renderHook(() =>
      useSessionSocket({
        bridge,
        hostReady: true,
        selectedSessionId: "session-1",
        socketReconnectVersion: 0,
        socketRef,
        socketStatusRef,
        pendingPromptRef,
        pendingPermissionDecisionsRef,
        appendEvent,
        setError,
        recordPanelLog,
      }),
    );

    expect(bridge.connectSession).toHaveBeenCalledOnce();
    expect(socketRef.current).toBe(socket);
    expect(socketStatusRef.current).toBe("connecting");

    onMessage?.({
      type: "event",
      event: {
        type: "turn.completed",
        sessionId: "session-1",
        turnId: "turn-1",
        stopReason: "end_turn",
        completedAt: "2026-04-20T01:00:01.000Z",
      },
    });

    expect(appendEvent).toHaveBeenCalledWith("session-1", expect.objectContaining({ type: "turn.completed" }));

    onStatus?.("open", { sessionId: "session-1" });

    expect(sendPrompt).toHaveBeenCalledWith(prompt);
    expect(resolvePermission).toHaveBeenCalledWith(decision);
    expect(pendingPromptRef.current).toBeNull();
    expect(pendingPermissionDecisionsRef.current).toEqual([]);

    unmount();

    expect(close).toHaveBeenCalledOnce();
    expect(socketRef.current).toBeNull();
    expect(socketStatusRef.current).toBe("closed");
  });
});
