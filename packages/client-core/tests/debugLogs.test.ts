import { describe, expect, it } from "vitest";
import type { DebugLogEntry } from "@browser-acp/shared-types";
import { appendDebugLogEntry, createDebugLogEntry } from "../src/index.js";

describe("debug log helpers", () => {
  it("creates panel-scoped log entries with optional details", () => {
    expect(createDebugLogEntry("started", undefined, "2026-04-26T00:00:00.000Z")).toEqual({
      timestamp: "2026-04-26T00:00:00.000Z",
      scope: "panel",
      message: "started",
      details: undefined,
    });

    expect(createDebugLogEntry("connected", { sessionId: "s1" }, "2026-04-26T00:00:01.000Z", "ws")).toEqual({
      timestamp: "2026-04-26T00:00:01.000Z",
      scope: "ws",
      message: "connected",
      details: { sessionId: "s1" },
    });
  });

  it("appends entries while keeping the most recent limit", () => {
    const entries: DebugLogEntry[] = [
      { timestamp: "1", scope: "panel", message: "one" },
      { timestamp: "2", scope: "panel", message: "two" },
    ];
    const next = appendDebugLogEntry(entries, { timestamp: "3", scope: "panel", message: "three" }, 2);

    expect(next).toEqual([
      { timestamp: "2", scope: "panel", message: "two" },
      { timestamp: "3", scope: "panel", message: "three" },
    ]);
    expect(entries).toHaveLength(2);
  });
});
