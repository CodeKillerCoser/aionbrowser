import { useEffect, useRef } from "react";
import type { BrowserContextBundle } from "@browser-acp/shared-types";
import {
  canProcessSelectionAction,
  getErrorMessage,
  shouldHandleSelectionActionSignal,
} from "@browser-acp/client-core";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";

export function useSelectionActionProcessor({
  bridge,
  selectionActionSignal,
  hostReady,
  context,
  activeAgentId,
  selectedSessionId,
  sendPrompt,
  setError,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "claimPendingSelectionAction">;
  selectionActionSignal: number;
  hostReady: boolean;
  context: BrowserContextBundle | null;
  activeAgentId: string;
  selectedSessionId: string;
  sendPrompt: (promptText: string) => Promise<boolean>;
  setError: (value: string | null) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  const selectionActionInFlightRef = useRef(false);
  const lastSelectionActionSignalRef = useRef(0);

  useEffect(() => {
    if (!hostReady || !context || !activeAgentId) {
      return;
    }

    if (!shouldHandleSelectionActionSignal(selectionActionSignal, lastSelectionActionSignalRef.current)) {
      return;
    }

    lastSelectionActionSignalRef.current = selectionActionSignal;

    void claimAndProcessSelectionAction();
  }, [activeAgentId, hostReady, context, selectionActionSignal, sendPrompt]);

  async function claimAndProcessSelectionAction(): Promise<void> {
    if (!canProcessSelectionAction({
      hostReady,
      context,
      agentId: activeAgentId,
      inFlight: selectionActionInFlightRef.current,
    })) {
      return;
    }

    selectionActionInFlightRef.current = true;

    try {
      const action = await bridge.claimPendingSelectionAction();
      if (!action) {
        return;
      }

      recordPanelLog("selection action claimed", {
        actionId: action.id,
        action: action.action,
        selectionLength: action.selectionText.length,
        hasSelectedSession: Boolean(selectedSessionId),
      });

      const didSend = await sendPrompt(action.promptText);
      if (didSend) {
        recordPanelLog("selection action prompt dispatched", {
          actionId: action.id,
          action: action.action,
        });
      }
    } catch (selectionActionError) {
      const message = getErrorMessage(selectionActionError);
      setError(message);
      recordPanelLog("selection action processing failed", {
        error: message,
      });
    } finally {
      selectionActionInFlightRef.current = false;
    }
  }
}
