import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserContextBundle } from "@browser-acp/shared-types";
import { useSelectionActionProcessor } from "../src/ui/sidepanel/hooks/useSelectionActionProcessor";

const context: BrowserContextBundle = {
  tabId: 1,
  url: "https://example.com",
  title: "Example",
  selectionText: "Beta",
  summaryMarkdown: "",
  openTabsPreview: [],
  capturedAt: "2026-04-20T01:00:00.000Z",
};

describe("useSelectionActionProcessor", () => {
  it("claims a pending selection action once per signal and dispatches its prompt", async () => {
    const claimPendingSelectionAction = vi.fn().mockResolvedValue({
      id: "action-1",
      action: "explain",
      selectionText: "Beta",
      promptText: "Explain Beta",
      createdAt: "2026-04-20T01:00:00.000Z",
    });
    const sendPrompt = vi.fn().mockResolvedValue(true);
    const recordPanelLog = vi.fn();
    const setError = vi.fn();

    const { rerender } = renderHook(
      ({ signal }) =>
        useSelectionActionProcessor({
          bridge: {
            claimPendingSelectionAction,
          },
          selectionActionSignal: signal,
          hostReady: true,
          context,
          activeAgentId: "agent-1",
          selectedSessionId: "session-1",
          sendPrompt,
          setError,
          recordPanelLog,
        }),
      {
        initialProps: {
          signal: 1,
        },
      },
    );

    await waitFor(() => {
      expect(sendPrompt).toHaveBeenCalledWith("Explain Beta");
    });

    rerender({
      signal: 1,
    });

    expect(claimPendingSelectionAction).toHaveBeenCalledTimes(1);

    rerender({
      signal: 2,
    });

    await waitFor(() => {
      expect(claimPendingSelectionAction).toHaveBeenCalledTimes(2);
    });
    expect(recordPanelLog).toHaveBeenCalledWith("selection action prompt dispatched", {
      actionId: "action-1",
      action: "explain",
    });
  });
});
