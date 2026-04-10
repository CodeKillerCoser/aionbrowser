import { describe, expect, it, vi } from "vitest";
import { createBackgroundRouter } from "../src/background/router";

describe("background router", () => {
  it("delegates selection actions to the pending action service", async () => {
    const queueSelectionAction = vi.fn().mockResolvedValue({ ok: true });
    const router = createBackgroundRouter({
      updateContextFromPage: vi.fn(),
      ensureDaemon: vi.fn(),
      listAgents: vi.fn(),
      listSessions: vi.fn(),
      getActiveContext: vi.fn(),
      getDebugState: vi.fn(),
      createSession: vi.fn(),
      queueSelectionAction,
      claimPendingSelectionAction: vi.fn(),
    });

    const result = await router.handle(
      {
        type: "browser-acp/trigger-selection-action",
        action: "explain",
        selectionText: "Alpha",
      },
      {
        tab: {
          id: 7,
          windowId: 3,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
    );

    expect(queueSelectionAction).toHaveBeenCalledWith("explain", "Alpha", {
      tabId: 7,
      windowId: 3,
    });
    expect(result).toEqual({ ok: true });
  });
});
