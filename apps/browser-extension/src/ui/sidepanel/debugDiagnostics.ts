import type { DebugLogEntry, SessionEvent } from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../messages";

export function formatDebugState(
  debugState: BackgroundDebugState | null,
  panelLogs: DebugLogEntry[],
  selectedSessionId: string,
  currentEvents: SessionEvent[],
): string {
  if (!debugState) {
    return "Diagnostics have not been loaded yet.";
  }

  const summary = {
    extensionId: debugState.extensionId,
    nativeHostName: debugState.nativeHostName,
    daemonBaseUrl: debugState.daemonBaseUrl,
    bootstrapCache: debugState.bootstrapCache,
    daemonStatus: debugState.daemonStatus,
  };

  const logText = formatLogEntries(debugState.logs);
  const daemonLogText = formatLogEntries(debugState.daemonLogs);
  const panelLogText = formatLogEntries(panelLogs);
  const rawSessionEventsText = currentEvents
    .map((event, index) => `#${index + 1}\n${JSON.stringify(event, null, 2)}`)
    .join("\n\n");

  return [
    `Summary: ${JSON.stringify(summary, null, 2)}`,
    "",
    "Logs:",
    logText || "No logs yet.",
    "",
    "Panel Logs:",
    panelLogText || "No panel logs yet.",
    "",
    "Daemon Logs:",
    daemonLogText || "No daemon logs yet.",
    "",
    `Current Session Events${selectedSessionId ? ` (${selectedSessionId})` : ""}:`,
    rawSessionEventsText || "No session events yet.",
  ].join("\n");
}

function formatLogEntries(entries: DebugLogEntry[]): string {
  return entries
    .map((entry) => {
      const details = entry.details === undefined ? "" : ` ${JSON.stringify(entry.details)}`;
      return `${entry.timestamp} [${entry.scope}] ${entry.message}${details}`;
    })
    .join("\n");
}
