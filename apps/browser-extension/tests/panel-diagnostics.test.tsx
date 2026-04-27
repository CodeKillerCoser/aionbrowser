import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../src/messages";
import { usePanelDiagnostics } from "../src/ui/sidepanel/hooks/usePanelDiagnostics";

const debugState: BackgroundDebugState = {
  extensionId: "extension-1",
  nativeHostName: "com.browser_acp.host",
  daemonBaseUrl: "http://127.0.0.1:9000",
  bootstrapCache: {
    ok: true,
    port: 9000,
    token: "token",
  },
  daemonStatus: {
    ok: true,
    port: 9000,
    token: "token",
  },
  daemonLogs: [
    {
      timestamp: "2026-04-20T01:00:00.000Z",
      scope: "runtime",
      message: "runtime ready",
    },
  ],
  logs: [],
};

describe("usePanelDiagnostics", () => {
  it("formats diagnostics text and refreshes debug state through the bridge", async () => {
    const nextDebugState: BackgroundDebugState = {
      ...debugState,
      daemonLogs: [
        ...debugState.daemonLogs,
        {
          timestamp: "2026-04-20T01:01:00.000Z",
          scope: "runtime",
          message: "runtime refreshed",
        },
      ],
    };
    const bridge = {
      getDebugState: vi.fn().mockResolvedValue(nextDebugState),
    };
    const recordPanelLog = vi.fn();
    const currentEvents: SessionEvent[] = [];

    const { result } = renderHook(() => {
      const [state, setDebugState] = useState(debugState);
      const [error, setError] = useState<string | null>(null);
      const diagnostics = usePanelDiagnostics({
        bridge,
        debugState: state,
        panelLogs: [],
        selectedSessionId: "session-1",
        currentEvents,
        setDebugState,
        setError,
        recordPanelLog,
      });

      return {
        ...diagnostics,
        error,
      };
    });

    expect(result.current.debugText).toContain("runtime ready");

    await act(async () => {
      await result.current.refreshDiagnostics();
    });

    expect(bridge.getDebugState).toHaveBeenCalledOnce();
    expect(result.current.debugText).toContain("runtime refreshed");
    expect(result.current.error).toBeNull();
    expect(recordPanelLog).toHaveBeenCalledWith("diagnostics refresh requested");
    expect(recordPanelLog).toHaveBeenCalledWith("diagnostics refresh completed", {
      daemonLogCount: 2,
      backgroundLogCount: 0,
    });
  });
});
