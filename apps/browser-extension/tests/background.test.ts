import { afterEach, describe, expect, it, vi } from "vitest";

describe("background behaviors", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the native side panel when the browser action is clicked", async () => {
    let actionClickListener: ((tab: chrome.tabs.Tab) => void | Promise<void>) | undefined;
    const sidePanelOpen = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      sidePanel: {
        open: sidePanelOpen,
      },
      action: {
        onClicked: {
          addListener: vi.fn((listener) => {
            actionClickListener = listener;
          }),
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        onActivated: {
          addListener: vi.fn(),
        },
        onUpdated: {
          addListener: vi.fn(),
        },
        query: vi.fn().mockResolvedValue([]),
      },
      scripting: {
        executeScript: vi.fn(),
      },
      runtime: {
        id: "test-extension",
        lastError: undefined,
        onMessage: {
          addListener: vi.fn(),
        },
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendNativeMessage: vi.fn(),
      },
    });

    await import("../src/background");

    expect(actionClickListener).toBeTypeOf("function");

    await actionClickListener?.({
      id: 9,
      windowId: 4,
      active: true,
      title: "Example page",
      url: "https://example.com/page",
    } as chrome.tabs.Tab);

    expect(sidePanelOpen).toHaveBeenCalledWith({
      windowId: 4,
    });
  });

  it("refreshes the active tab snapshot before broadcasting a page context update", async () => {
    let runtimeMessageListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void) => boolean)
      | undefined;

    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          url: "https://example.com/page",
          title: "Example page",
          selectionText: "Fresh selection",
          summaryMarkdown: "Fresh summary",
          hasFocus: true,
        },
      },
    ]);
    const runtimeSendMessage = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      sidePanel: {
        setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      },
      action: {
        onClicked: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        onActivated: {
          addListener: vi.fn(),
        },
        onUpdated: {
          addListener: vi.fn(),
        },
        query: vi.fn().mockResolvedValue([
          {
            id: 7,
            active: true,
            title: "Example page",
            url: "https://example.com/page",
          },
        ]),
      },
      scripting: {
        executeScript,
      },
      runtime: {
        id: "test-extension",
        lastError: undefined,
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeMessageListener = listener;
          }),
        },
        sendMessage: runtimeSendMessage,
        sendNativeMessage: vi.fn(),
      },
    });

    await import("../src/background");

    expect(runtimeMessageListener).toBeTypeOf("function");

    const sendResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/context-update",
        payload: {
          url: "https://example.com/page",
          title: "Example page",
          selectionText: "",
          summaryMarkdown: "Stale summary",
          hasFocus: true,
        },
      },
      {
        tab: {
          id: 7,
          title: "Example page",
          url: "https://example.com/page",
        } as chrome.tabs.Tab,
      },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(executeScript).toHaveBeenCalledTimes(1);
      expect(runtimeSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "browser-acp/context-changed",
          context: expect.objectContaining({
            tabId: 7,
            selectionText: "Fresh selection",
            summaryMarkdown: "Fresh summary",
          }),
        }),
      );
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
  });

  it("queues a pending selection action, opens the native side panel, and lets the panel claim it once", async () => {
    let runtimeMessageListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void) => boolean)
      | undefined;

    const sidePanelOpen = vi.fn().mockResolvedValue(undefined);
    const storageSet = vi.fn().mockResolvedValue(undefined);
    const runtimeSendMessage = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      sidePanel: {
        open: sidePanelOpen,
      },
      action: {
        onClicked: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: storageSet,
        },
      },
      tabs: {
        onActivated: {
          addListener: vi.fn(),
        },
        onUpdated: {
          addListener: vi.fn(),
        },
        query: vi.fn().mockResolvedValue([]),
      },
      scripting: {
        executeScript: vi.fn(),
      },
      runtime: {
        id: "test-extension",
        lastError: undefined,
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeMessageListener = listener;
          }),
        },
        sendMessage: runtimeSendMessage,
        sendNativeMessage: vi.fn(),
      },
    });

    await import("../src/background");

    expect(runtimeMessageListener).toBeTypeOf("function");

    const triggerResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/trigger-selection-action",
        action: "explain",
        selectionText: "Beta",
      },
      {
        tab: {
          id: 7,
          windowId: 3,
          title: "Example page",
          url: "https://example.com/page",
        } as chrome.tabs.Tab,
      },
      triggerResponse,
    );

    await vi.waitFor(() => {
      expect(sidePanelOpen).toHaveBeenCalledWith({
        windowId: 3,
      });
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        type: "browser-acp/selection-action-ready",
      });
      expect(triggerResponse).toHaveBeenCalledWith({ ok: true });
    });
    const pendingActionStorageCall = storageSet.mock.calls.findIndex((call) => {
      const payload = call[0] as Record<string, unknown>;
      return "browser-acp-pending-selection-action" in payload;
    });
    expect(pendingActionStorageCall).toBeGreaterThanOrEqual(0);
    expect(sidePanelOpen.mock.invocationCallOrder[0]).toBeLessThan(
      storageSet.mock.invocationCallOrder[pendingActionStorageCall],
    );

    const firstClaimResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/claim-pending-selection-action",
      },
      {},
      firstClaimResponse,
    );

    await vi.waitFor(() => {
      expect(firstClaimResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "explain",
          selectionText: "Beta",
          promptText: expect.stringContaining("Beta"),
        }),
      );
    });

    const secondClaimResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/claim-pending-selection-action",
      },
      {},
      secondClaimResponse,
    );

    await vi.waitFor(() => {
      expect(secondClaimResponse).toHaveBeenCalledWith(null);
    });
  });

  it("persists a pending selection action across a background restart before the panel claims it", async () => {
    let runtimeMessageListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void) => boolean)
      | undefined;

    const storageState: Record<string, unknown> = {};
    const storageGet = vi.fn(async (key?: string | string[] | Record<string, unknown>) => {
      if (typeof key === "string") {
        return { [key]: storageState[key] };
      }

      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, storageState[entry]]));
      }

      return { ...storageState };
    });
    const storageSet = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(storageState, values);
    });

    const stubChrome = () => {
      vi.stubGlobal("chrome", {
        sidePanel: {
          open: vi.fn().mockResolvedValue(undefined),
        },
        action: {
          onClicked: {
            addListener: vi.fn(),
          },
        },
        storage: {
          local: {
            get: storageGet,
            set: storageSet,
          },
        },
        tabs: {
          onActivated: {
            addListener: vi.fn(),
          },
          onUpdated: {
            addListener: vi.fn(),
          },
          query: vi.fn().mockResolvedValue([]),
        },
        scripting: {
          executeScript: vi.fn(),
        },
        runtime: {
          id: "test-extension",
          lastError: undefined,
          onMessage: {
            addListener: vi.fn((listener) => {
              runtimeMessageListener = listener;
            }),
          },
          sendMessage: vi.fn().mockResolvedValue(undefined),
          sendNativeMessage: vi.fn(),
        },
      });
    };

    stubChrome();
    await import("../src/background");

    const triggerResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/trigger-selection-action",
        action: "search",
        selectionText: "Beta",
      },
      {
        tab: {
          id: 7,
          windowId: 3,
          title: "Example page",
          url: "https://example.com/page",
        } as chrome.tabs.Tab,
      },
      triggerResponse,
    );

    await vi.waitFor(() => {
      expect(triggerResponse).toHaveBeenCalledWith({ ok: true });
    });

    vi.resetModules();
    stubChrome();
    await import("../src/background");

    const claimResponse = vi.fn();
    runtimeMessageListener?.(
      {
        type: "browser-acp/claim-pending-selection-action",
      },
      {},
      claimResponse,
    );

    await vi.waitFor(() => {
      expect(claimResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "search",
          selectionText: "Beta",
          promptText: expect.stringContaining("Beta"),
        }),
      );
    });
  });
});
