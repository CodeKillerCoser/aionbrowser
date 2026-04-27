import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BrowserContextBundle } from "@browser-acp/shared-types";
import { keepNewerContext } from "@browser-acp/client-core";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";

export function useActiveContextSubscription({
  bridge,
  setContext,
  recordPanelLog,
}: {
  bridge: Pick<BrowserAcpBridge, "subscribeToActiveContext">;
  setContext: Dispatch<SetStateAction<BrowserContextBundle | null>>;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  useEffect(() => {
    const unsubscribe = bridge.subscribeToActiveContext((nextContext) => {
      setContext((current) => keepNewerContext(current, nextContext));
      recordPanelLog("active context synchronized", {
        tabId: nextContext.tabId,
        title: nextContext.title,
        url: nextContext.url,
        selectionLength: nextContext.selectionText.length,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, recordPanelLog, setContext]);
}
