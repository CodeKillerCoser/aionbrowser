import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { PermissionDecision, PromptEnvelope, SessionEvent } from "@browser-acp/shared-types";
import {
  getNextSessionSocketStatus,
  shouldClearSessionSocketRef,
  shouldFlushPendingPermissions,
  shouldFlushPendingPrompt,
  type SessionSocketStatus,
} from "@browser-acp/client-core";
import type { BrowserAcpBridge, BrowserAcpSocket } from "../../../host-api/agentConsoleHost";

export function useSessionSocket({
  bridge,
  hostReady,
  selectedSessionId,
  socketReconnectVersion,
  socketRef,
  socketStatusRef,
  pendingPromptRef,
  pendingPermissionDecisionsRef,
  appendEvent,
  setError,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "connectSession">;
  hostReady: boolean;
  selectedSessionId: string;
  socketReconnectVersion: number;
  socketRef: MutableRefObject<BrowserAcpSocket | null>;
  socketStatusRef: MutableRefObject<SessionSocketStatus>;
  pendingPromptRef: MutableRefObject<PromptEnvelope | null>;
  pendingPermissionDecisionsRef: MutableRefObject<PermissionDecision[]>;
  appendEvent: (sessionId: string, event: SessionEvent) => void;
  setError: (value: string | null) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  useEffect(() => {
    if (!hostReady || !selectedSessionId) {
      socketRef.current = null;
      socketStatusRef.current = "idle";
      return;
    }

    recordPanelLog("session websocket connecting", {
      sessionId: selectedSessionId,
    });
    socketRef.current?.close();
    socketStatusRef.current = "connecting";
    let activeSocket: BrowserAcpSocket | null = null;
    const socket = bridge.connectSession(
      selectedSessionId,
      (message) => {
        if (message.type === "error") {
          recordPanelLog("session websocket error payload received", {
            sessionId: selectedSessionId,
            error: message.error,
          });
          setError(message.error ?? "Unknown session error.");
          return;
        }

        if (message.event) {
          const nextEvent = message.event;
          recordPanelLog("session event received", {
            sessionId: selectedSessionId,
            eventType: nextEvent.type,
          });
          appendEvent(selectedSessionId, nextEvent);
        }
      },
      (socketError) => {
        recordPanelLog("session websocket failed", {
          sessionId: selectedSessionId,
          error: socketError,
        });
        setError(socketError);
      },
      (status, details) => {
        if (socketRef.current === activeSocket) {
          socketStatusRef.current = getNextSessionSocketStatus(socketStatusRef.current, status);
          if (shouldClearSessionSocketRef(status)) {
            socketRef.current = null;
          }
        }
        recordPanelLog(`session websocket ${status}`, {
          sessionId: selectedSessionId,
          ...details,
        });
        if (shouldFlushPendingPrompt(status, pendingPromptRef.current?.sessionId, selectedSessionId)) {
          const pendingPrompt = pendingPromptRef.current;
          pendingPromptRef.current = null;
          if (pendingPrompt) {
            socketRef.current?.sendPrompt(pendingPrompt);
          }
          recordPanelLog("pending prompt flushed after websocket open", {
            sessionId: selectedSessionId,
            textLength: pendingPrompt?.text.length ?? 0,
          });
        }
        if (shouldFlushPendingPermissions(status, pendingPermissionDecisionsRef.current.length)) {
          while (pendingPermissionDecisionsRef.current.length > 0) {
            const decision = pendingPermissionDecisionsRef.current.shift()!;
            socketRef.current?.resolvePermission(decision);
            recordPanelLog("pending permission decision flushed after websocket open", {
              sessionId: selectedSessionId,
              permissionId: decision.permissionId,
              outcome: decision.outcome,
              optionId: decision.optionId,
            });
          }
        }
      },
    );
    activeSocket = socket;
    socketRef.current = socket;

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        socketStatusRef.current = "closed";
      }
      socket.close();
    };
  }, [
    appendEvent,
    bridge,
    hostReady,
    pendingPermissionDecisionsRef,
    pendingPromptRef,
    recordPanelLog,
    selectedSessionId,
    setError,
    socketReconnectVersion,
    socketRef,
    socketStatusRef,
  ]);
}
