import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PermissionDecision } from "@browser-acp/shared-types";
import type { BrowserAcpSocket } from "../src/host-api/agentConsoleHost";
import { usePermissionResolver } from "../src/ui/sidepanel/hooks/usePermissionResolver";

describe("usePermissionResolver", () => {
  it("sends permission decisions through an open socket and marks them submitting", () => {
    const decision: PermissionDecision = {
      permissionId: "permission-1",
      outcome: "selected",
      optionId: "allow",
    };
    const resolvePermission = vi.fn();
    const recordPanelLog = vi.fn();
    const markPermissionSubmitting = vi.fn();
    const setSocketReconnectVersion = vi.fn();
    const socketRef = {
      current: {
        sendPrompt: vi.fn(),
        resolvePermission,
        close: vi.fn(),
      } satisfies BrowserAcpSocket,
    };
    const socketStatusRef = {
      current: "open" as const,
    };
    const pendingPermissionDecisionsRef = {
      current: [] as PermissionDecision[],
    };

    const { result } = renderHook(() =>
      usePermissionResolver({
        hostReady: true,
        selectedSessionId: "session-1",
        socketRef,
        socketStatusRef,
        pendingPermissionDecisionsRef,
        markPermissionSubmitting,
        setSocketReconnectVersion,
        recordPanelLog,
      }),
    );

    result.current.resolvePermissionDecision("permission-1", decision);

    expect(markPermissionSubmitting).toHaveBeenCalledWith("permission-1");
    expect(resolvePermission).toHaveBeenCalledWith(decision);
    expect(pendingPermissionDecisionsRef.current).toEqual([]);
    expect(setSocketReconnectVersion).not.toHaveBeenCalled();
    expect(recordPanelLog).toHaveBeenCalledWith("permission decision sent", {
      sessionId: "session-1",
      permissionId: "permission-1",
      outcome: "selected",
      optionId: "allow",
    });
  });

  it("queues permission decisions and requests reconnect when the socket is unavailable", () => {
    const decision: PermissionDecision = {
      permissionId: "permission-2",
      outcome: "cancelled",
    };
    const recordPanelLog = vi.fn();
    const markPermissionSubmitting = vi.fn();
    const setSocketReconnectVersion = vi.fn();
    const socketRef = {
      current: null as BrowserAcpSocket | null,
    };
    const socketStatusRef = {
      current: "closed" as const,
    };
    const pendingPermissionDecisionsRef = {
      current: [] as PermissionDecision[],
    };

    const { result } = renderHook(() =>
      usePermissionResolver({
        hostReady: true,
        selectedSessionId: "session-1",
        socketRef,
        socketStatusRef,
        pendingPermissionDecisionsRef,
        markPermissionSubmitting,
        setSocketReconnectVersion,
        recordPanelLog,
      }),
    );

    result.current.resolvePermissionDecision("permission-2", decision);

    expect(markPermissionSubmitting).toHaveBeenCalledWith("permission-2");
    expect(pendingPermissionDecisionsRef.current).toEqual([decision]);
    expect(setSocketReconnectVersion).toHaveBeenCalledOnce();
    expect(recordPanelLog).toHaveBeenCalledWith("permission decision queued while websocket reconnects", {
      sessionId: "session-1",
      permissionId: "permission-2",
      outcome: "cancelled",
      optionId: undefined,
    });
  });
});
