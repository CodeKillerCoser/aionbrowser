import { useCallback, useMemo } from "react";
import type { DebugLogEntry, SessionEvent } from "@browser-acp/shared-types";
import { getErrorMessage } from "@browser-acp/client-core";
import type { BackgroundDebugState } from "../../../messages";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";
import { formatDebugState } from "../debugDiagnostics";

export function usePanelDiagnostics({
  bridge,
  debugState,
  panelLogs,
  selectedSessionId,
  currentEvents,
  setDebugState,
  setError,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "getDebugState">;
  debugState: BackgroundDebugState | null;
  panelLogs: DebugLogEntry[];
  selectedSessionId: string;
  currentEvents: SessionEvent[];
  setDebugState: (value: BackgroundDebugState) => void;
  setError: (value: string | null) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  const debugText = useMemo(
    () => formatDebugState(debugState, panelLogs, selectedSessionId, currentEvents),
    [currentEvents, debugState, panelLogs, selectedSessionId],
  );

  const refreshDiagnostics = useCallback(async () => {
    try {
      recordPanelLog("diagnostics refresh requested");
      const nextDebugState = await bridge.getDebugState();
      setDebugState(nextDebugState);
      recordPanelLog("diagnostics refresh completed", {
        daemonLogCount: nextDebugState.daemonLogs.length,
        backgroundLogCount: nextDebugState.logs.length,
      });
    } catch (refreshError) {
      const message = getErrorMessage(refreshError);
      setError(message);
      recordPanelLog("diagnostics refresh failed", {
        error: message,
      });
    }
  }, [bridge, recordPanelLog, setDebugState, setError]);

  return {
    debugText,
    refreshDiagnostics,
  };
}
