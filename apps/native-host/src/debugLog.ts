import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DAEMON_LOG_FILE_NAME } from "@browser-acp/config";
import type { DebugLogEntry } from "@browser-acp/shared-types";

export interface FileDebugLogger {
  log(scope: string, message: string, details?: unknown): Promise<void>;
}

export function createFileDebugLogger(logPath: string): FileDebugLogger {
  return {
    async log(scope: string, message: string, details?: unknown): Promise<void> {
      const entry: DebugLogEntry = {
        timestamp: new Date().toISOString(),
        scope,
        message,
        details: details === undefined ? undefined : sanitizeDebugValue(details),
      };

      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    },
  };
}

export async function appendRootDebugLog(
  rootDir: string,
  scope: string,
  message: string,
  details?: unknown,
): Promise<void> {
  await createFileDebugLogger(join(rootDir, DAEMON_LOG_FILE_NAME)).log(scope, message, details);
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 400 ? `${value.slice(0, 397)}...` : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (depth >= 3) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeDebugValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 20).map(([key, entryValue]) => [key, sanitizeDebugValue(entryValue, depth + 1)]),
    );
  }

  return String(value);
}
