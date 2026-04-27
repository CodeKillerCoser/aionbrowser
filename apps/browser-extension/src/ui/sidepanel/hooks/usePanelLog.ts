import { useCallback, useState } from "react";
import type { DebugLogEntry } from "@browser-acp/shared-types";
import {
  appendDebugLogEntry,
  createDebugLogEntry,
} from "@browser-acp/client-core";

export function usePanelLog() {
  const [panelLogs, setPanelLogs] = useState<DebugLogEntry[]>([]);
  const recordPanelLog = useCallback((message: string, details?: unknown, scope = "panel") => {
    const entry = createDebugLogEntry(message, details, new Date().toISOString(), scope);
    setPanelLogs((current) => appendDebugLogEntry(current, entry));
  }, []);

  return {
    panelLogs,
    recordPanelLog,
  };
}
