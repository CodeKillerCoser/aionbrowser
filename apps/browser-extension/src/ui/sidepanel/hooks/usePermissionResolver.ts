import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { PermissionDecision } from "@browser-acp/shared-types";
import {
  isSessionSocketUnavailable,
  type SessionSocketStatus,
} from "@browser-acp/client-core";
import type { BrowserAcpSocket } from "../../../host-api/agentConsoleHost";

export function usePermissionResolver({
  hostReady,
  selectedSessionId,
  socketRef,
  socketStatusRef,
  pendingPermissionDecisionsRef,
  markPermissionSubmitting,
  setSocketReconnectVersion,
  recordPanelLog,
}: {
  hostReady: boolean;
  selectedSessionId: string;
  socketRef: MutableRefObject<BrowserAcpSocket | null>;
  socketStatusRef: MutableRefObject<SessionSocketStatus>;
  pendingPermissionDecisionsRef: MutableRefObject<PermissionDecision[]>;
  markPermissionSubmitting: (permissionId: string) => void;
  setSocketReconnectVersion: (update: (current: number) => number) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  const resolvePermissionDecision = useCallback((permissionId: string, decision: PermissionDecision): void => {
    if (!hostReady || !selectedSessionId) {
      recordPanelLog("permission decision ignored because session state is missing", {
        hostReady,
        sessionId: selectedSessionId,
        permissionId: decision.permissionId,
      });
      return;
    }

    markPermissionSubmitting(permissionId);

    const socket = socketRef.current;
    if (!socket || isSessionSocketUnavailable(true, socketStatusRef.current)) {
      pendingPermissionDecisionsRef.current.push(decision);
      setSocketReconnectVersion((current) => current + 1);
      recordPanelLog("permission decision queued while websocket reconnects", {
        sessionId: selectedSessionId,
        permissionId: decision.permissionId,
        outcome: decision.outcome,
        optionId: decision.optionId,
      });
      return;
    }

    socket.resolvePermission(decision);
    recordPanelLog("permission decision sent", {
      sessionId: selectedSessionId,
      permissionId: decision.permissionId,
      outcome: decision.outcome,
      optionId: decision.optionId,
    });
  }, [
    hostReady,
    markPermissionSubmitting,
    pendingPermissionDecisionsRef,
    recordPanelLog,
    selectedSessionId,
    setSocketReconnectVersion,
    socketRef,
    socketStatusRef,
  ]);

  return {
    resolvePermissionDecision,
  };
}
