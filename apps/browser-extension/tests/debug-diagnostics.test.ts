import { describe, expect, it } from "vitest";
import type { DebugLogEntry, SessionEvent } from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../src/messages";
import { formatDebugState } from "../src/ui/sidepanel/debugDiagnostics";

describe("debug diagnostics formatting", () => {
  it("shows an unloaded message before diagnostics are available", () => {
    expect(formatDebugState(null, [], "", [])).toBe("Diagnostics have not been loaded yet.");
  });

  it("formats summary, logs, daemon logs, panel logs, and current session events", () => {
    const extensionLog: DebugLogEntry = {
      timestamp: "2026-04-24T01:00:00.000Z",
      scope: "background",
      message: "started",
      details: { tabId: 7 },
    };
    const daemonLog: DebugLogEntry = {
      timestamp: "2026-04-24T01:00:01.000Z",
      scope: "daemon",
      message: "ready",
    };
    const panelLog: DebugLogEntry = {
      timestamp: "2026-04-24T01:00:02.000Z",
      scope: "panel",
      message: "rendered",
    };
    const event: SessionEvent = {
      type: "turn.completed",
      sessionId: "session-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      completedAt: "2026-04-24T01:00:03.000Z",
    };
    const debugState: BackgroundDebugState = {
      extensionId: "extension-1",
      nativeHostName: "com.browser_acp.native",
      daemonBaseUrl: "http://127.0.0.1:1234",
      bootstrapCache: null,
      daemonStatus: null,
      logs: [extensionLog],
      daemonLogs: [daemonLog],
    };

    const text = formatDebugState(debugState, [panelLog], "session-1", [event]);

    expect(text).toContain('"extensionId": "extension-1"');
    expect(text).toContain('2026-04-24T01:00:00.000Z [background] started {"tabId":7}');
    expect(text).toContain("2026-04-24T01:00:01.000Z [daemon] ready");
    expect(text).toContain("2026-04-24T01:00:02.000Z [panel] rendered");
    expect(text).toContain("Current Session Events (session-1):");
    expect(text).toContain('"stopReason": "end_turn"');
  });
});
