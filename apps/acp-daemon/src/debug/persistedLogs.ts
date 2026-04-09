import { readFile } from "node:fs/promises";
import type { DebugLogEntry } from "@browser-acp/shared-types";

const LOG_LIMIT = 200;

export async function readPersistedDebugLogs(logPath: string): Promise<DebugLogEntry[]> {
  try {
    const raw = await readFile(logPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseDebugLogEntry)
      .filter((entry): entry is DebugLogEntry => entry !== undefined)
      .slice(-LOG_LIMIT);
  } catch {
    return [];
  }
}

function parseDebugLogEntry(line: string): DebugLogEntry | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (
      typeof parsed.timestamp === "string" &&
      typeof parsed.scope === "string" &&
      typeof parsed.message === "string"
    ) {
      return {
        timestamp: parsed.timestamp,
        scope: parsed.scope,
        message: parsed.message,
        details: parsed.details,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
