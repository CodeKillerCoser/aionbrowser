import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  BrowserContextBundle,
  ConversationSummary,
  PromptEnvelope,
} from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../../messages";
import {
  PENDING_SESSION_ID,
  addOptimisticPrompt,
  buildPromptEnvelope,
  canSubmitPrompt,
  createOptimisticPromptId,
  getErrorMessage,
  isSessionSocketUnavailable,
  keepNewerContext,
  markOptimisticPromptFailed,
  moveOptimisticPromptToSession,
  updateOptimisticPromptContext,
  upsertConversationSummary,
  type OptimisticPrompt,
  type SessionSocketStatus,
} from "@browser-acp/client-core";
import type { BrowserAcpBridge, BrowserAcpSocket } from "../../../host-api/agentConsoleHost";

export function usePromptSender({
  bridge,
  hostReady,
  context,
  activeAgentId,
  selectedAgentId,
  selectedSessionId,
  socketRef,
  socketStatusRef,
  pendingPromptRef,
  setSocketReconnectVersion,
  setContext,
  setOptimisticPrompts,
  setSessions,
  setSelectedSessionId,
  setSelectedAgentId,
  setError,
  setDebugState,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "getActiveContext" | "createSession" | "getDebugState">;
  hostReady: boolean;
  context: BrowserContextBundle | null;
  activeAgentId: string;
  selectedAgentId: string;
  selectedSessionId: string;
  socketRef: MutableRefObject<BrowserAcpSocket | null>;
  socketStatusRef: MutableRefObject<SessionSocketStatus>;
  pendingPromptRef: MutableRefObject<PromptEnvelope | null>;
  setSocketReconnectVersion: Dispatch<SetStateAction<number>>;
  setContext: Dispatch<SetStateAction<BrowserContextBundle | null>>;
  setOptimisticPrompts: Dispatch<SetStateAction<OptimisticPrompt[]>>;
  setSessions: Dispatch<SetStateAction<ConversationSummary[]>>;
  setSelectedSessionId: Dispatch<SetStateAction<string>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  setError: (value: string | null) => void;
  setDebugState: (value: BackgroundDebugState) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  const sendPrompt = useCallback(async (promptText: string): Promise<boolean> => {
    const trimmedPrompt = promptText.trim();

    if (!canSubmitPrompt({ hostReady, context, agentId: activeAgentId, text: trimmedPrompt })) {
      recordPanelLog("send prompt ignored because required state is missing", {
        hostReady,
        hasContext: Boolean(context),
        selectedAgentId: activeAgentId,
        draftLength: trimmedPrompt.length,
      });
      return false;
    }

    if (!context) {
      return false;
    }

    let activeContext = context;
    const optimisticPromptId = createOptimisticPromptId();
    const optimisticSessionId = selectedSessionId || PENDING_SESSION_ID;

    setOptimisticPrompts((current) =>
      addOptimisticPrompt(current, {
        id: optimisticPromptId,
        sessionId: optimisticSessionId,
        agentId: activeAgentId,
        text: trimmedPrompt,
        createdAt: new Date(),
        context: activeContext,
      }),
    );

    try {
      activeContext = await bridge.getActiveContext();
      setContext((current) => keepNewerContext(current, activeContext));
      setOptimisticPrompts((current) => updateOptimisticPromptContext(current, optimisticPromptId, activeContext));
      recordPanelLog("active context refreshed before send", {
        tabId: activeContext.tabId,
        title: activeContext.title,
        url: activeContext.url,
        selectionLength: activeContext.selectionText.length,
      });
    } catch (contextError) {
      recordPanelLog("active context refresh failed before send", {
        error: getErrorMessage(contextError),
      });
    }

    let sessionId = selectedSessionId;
    const promptEnvelope: PromptEnvelope = buildPromptEnvelope({
      sessionId: sessionId || PENDING_SESSION_ID,
      agentId: activeAgentId,
      text: trimmedPrompt,
      context: activeContext,
    });

    try {
      if (!sessionId) {
        recordPanelLog("create session requested", {
          agentId: activeAgentId,
          pageTitle: activeContext.title,
        });
        const summary = await bridge.createSession(activeAgentId, activeContext);
        setSessions((current) => upsertConversationSummary(current, summary));
        setSelectedSessionId(summary.id);
        setSelectedAgentId(summary.agentId);
        setError(null);
        sessionId = summary.id;
        setOptimisticPrompts((current) => moveOptimisticPromptToSession(current, optimisticPromptId, summary.id));
        recordPanelLog("create session completed", {
          sessionId: summary.id,
          agentId: summary.agentId,
        });
        pendingPromptRef.current = {
          ...promptEnvelope,
          sessionId: summary.id,
        };
        recordPanelLog("prompt queued until websocket opens", {
          sessionId: summary.id,
          agentId: selectedAgentId,
          textLength: trimmedPrompt.length,
        });
        return true;
      }

      const socket = socketRef.current;
      if (!socket || isSessionSocketUnavailable(true, socketStatusRef.current)) {
        pendingPromptRef.current = {
          ...promptEnvelope,
          sessionId,
        };
        setSocketReconnectVersion((current) => current + 1);
        recordPanelLog("prompt queued while websocket reconnects", {
          sessionId,
          agentId: activeAgentId,
          textLength: trimmedPrompt.length,
        });
        return true;
      }

      recordPanelLog("prompt dispatched from panel", {
        sessionId,
        agentId: activeAgentId,
        textLength: trimmedPrompt.length,
      });
      socket.sendPrompt({
        ...promptEnvelope,
        sessionId,
      });
      setError(null);
      return true;
    } catch (sendError) {
      const message = getErrorMessage(sendError);
      setError(message);
      setOptimisticPrompts((current) => markOptimisticPromptFailed(current, optimisticPromptId, message));
      recordPanelLog("send prompt failed", {
        error: message,
        sessionId,
        agentId: activeAgentId,
      });
      try {
        const nextDebugState = await bridge.getDebugState();
        setDebugState(nextDebugState);
      } catch {
        // Ignore diagnostics refresh failures.
      }
      return true;
    }
  }, [
    activeAgentId,
    bridge,
    context,
    hostReady,
    pendingPromptRef,
    recordPanelLog,
    selectedAgentId,
    selectedSessionId,
    setContext,
    setDebugState,
    setError,
    setOptimisticPrompts,
    setSelectedAgentId,
    setSelectedSessionId,
    setSessions,
    setSocketReconnectVersion,
    socketRef,
    socketStatusRef,
  ]);

  return {
    sendPrompt,
  };
}
