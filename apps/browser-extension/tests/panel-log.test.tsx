import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePanelLog } from "../src/ui/sidepanel/hooks/usePanelLog";

describe("usePanelLog", () => {
  it("records panel log entries with a stable logger callback", () => {
    const { result, rerender } = renderHook(() => usePanelLog());

    const firstLogger = result.current.recordPanelLog;

    act(() => {
      result.current.recordPanelLog("diagnostics refresh requested", { sessionId: "session-1" }, "debug");
    });

    expect(result.current.panelLogs).toEqual([
      expect.objectContaining({
        message: "diagnostics refresh requested",
        details: {
          sessionId: "session-1",
        },
        scope: "debug",
        timestamp: expect.any(String),
      }),
    ]);

    rerender();

    expect(result.current.recordPanelLog).toBe(firstLogger);
  });
});
