import { useEffect } from "react";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";

export function useSelectionActionSubscription({
  bridge,
  onSignal,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "subscribeToSelectionActions">;
  onSignal: () => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  useEffect(() => {
    const unsubscribe = bridge.subscribeToSelectionActions(() => {
      onSignal();
      recordPanelLog("selection action notification received");
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, onSignal, recordPanelLog]);
}
