import type { DebugLogEntry } from "@browser-acp/shared-types";

const LOG_LIMIT = 200;
const STRING_LOG_LIMIT = 5000;
const DEBUG_VALUE_DEPTH_LIMIT = 8;
const DEBUG_VALUE_ENTRY_LIMIT = 40;

export interface DebugLogger {
  log(scope: string, message: string, details?: unknown): void;
  entries(): DebugLogEntry[];
}

export function createDebugLogger(): DebugLogger {
  const logs: DebugLogEntry[] = [];

  return {
    log(scope: string, message: string, details?: unknown): void {
      const entry: DebugLogEntry = {
        timestamp: new Date().toISOString(),
        scope,
        message,
        details: details === undefined ? undefined : sanitizeDebugValue(details),
      };

      logs.push(entry);
      if (logs.length > LOG_LIMIT) {
        logs.splice(0, logs.length - LOG_LIMIT);
      }

      try {
        process.stderr.write(`${JSON.stringify(entry)}\n`);
      } catch {
        // Ignore debug log sink failures.
      }
    },
    entries(): DebugLogEntry[] {
      return [...logs];
    },
  };
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > STRING_LOG_LIMIT
      ? `${value.slice(0, STRING_LOG_LIMIT - 3)}...`
      : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (depth >= DEBUG_VALUE_DEPTH_LIMIT) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, DEBUG_VALUE_ENTRY_LIMIT).map((entry) => sanitizeDebugValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, DEBUG_VALUE_ENTRY_LIMIT)
        .map(([key, entryValue]) => [key, sanitizeDebugValue(entryValue, depth + 1)]),
    );
  }

  return String(value);
}
