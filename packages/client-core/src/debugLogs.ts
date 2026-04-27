import type { DebugLogEntry } from "@browser-acp/shared-types";

export function createDebugLogEntry(
  message: string,
  details: unknown | undefined,
  timestamp: string,
  scope = "panel",
): DebugLogEntry {
  return {
    timestamp,
    scope,
    message,
    details: details === undefined ? undefined : details,
  };
}

export function appendDebugLogEntry(
  current: DebugLogEntry[],
  entry: DebugLogEntry,
  limit = 80,
): DebugLogEntry[] {
  return [...current, entry].slice(-limit);
}
