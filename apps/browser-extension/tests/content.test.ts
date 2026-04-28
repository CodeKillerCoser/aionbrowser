import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("content script", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <p id="target">Selection test page.</p>
      </main>
    `;
  });

  afterEach(() => {
    window.__browserAcpSelectionMenuCleanup__?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function selectTargetText() {
    const target = document.getElementById("target");
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function createChromeStub() {
    let runtimeMessageListener: ((message: unknown) => void) | undefined;
    const storageGet = vi.fn().mockResolvedValue({});
    const storageSet = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn((message: unknown, callback?: (response: unknown) => void) => {
      if (typeof callback !== "function") {
        return;
      }

      if (typeof message === "object" && message !== null && "type" in message) {
        const type = (message as { type: string }).type;
        if (type === "browser-acp/ensure-daemon") {
          callback({ ok: true, port: 9000, token: "token" });
          return;
        }

        if (type === "browser-acp/list-agents") {
          callback([
            {
              id: "mock-agent",
              name: "Mock Agent",
              source: "user",
              distribution: {
                type: "custom",
                command: "mock-agent",
              },
              status: "ready",
              launchCommand: "mock-agent",
              launchArgs: [],
            },
          ]);
          return;
        }

        if (type === "browser-acp/list-sessions") {
          callback([]);
          return;
        }

        if (type === "browser-acp/get-active-context") {
          callback({
            tabId: 1,
            url: "https://example.com/page",
            title: "Example page",
            selectionText: "Selection test page.",
            summaryMarkdown: "Summary",
            openTabsPreview: [],
            capturedAt: "2026-04-09T00:00:00.000Z",
          });
          return;
        }

        if (type === "browser-acp/list-page-task-templates") {
          callback([
            {
              id: "custom-explain",
              title: "讲讲",
              promptTemplate: "讲讲 {{selectionText}}",
              enabled: true,
            },
            {
              id: "disabled",
              title: "隐藏",
              promptTemplate: "隐藏 {{selectionText}}",
              enabled: false,
            },
          ]);
          return;
        }

        if (type === "browser-acp/get-debug-state") {
          callback({
            extensionId: "test-extension",
            nativeHostName: "com.browser_acp.host",
            daemonBaseUrl: "http://127.0.0.1",
            bootstrapCache: { ok: true, port: 9000, token: "token" },
            daemonStatus: { ok: true, port: 9000, token: "token" },
            daemonLogs: [],
            logs: [],
          });
          return;
        }

        if (type === "browser-acp/claim-pending-selection-action") {
          callback(null);
          return;
        }
      }

      callback(undefined);
    });

    vi.stubGlobal("WebSocket", class MockWebSocket {
      static OPEN = 1;
      readyState = 1;
      addEventListener(_event: string, handler: (event?: unknown) => void) {
        if (_event === "open") {
          queueMicrotask(() => handler());
        }
      }
      send() {}
      close() {}
    });

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: storageGet,
          set: storageSet,
        },
      },
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeMessageListener = listener;
          }),
          removeListener: vi.fn(),
        },
      },
    });

    return {
      sendMessage,
      storageGet,
      storageSet,
      dispatchRuntimeMessage(message: unknown) {
        runtimeMessageListener?.(message);
      },
    };
  }

  it("shows a quick action popup after mouseup when text is selected", async () => {
    const { sendMessage } = createChromeStub();

    await import("../src/content");

    selectTargetText();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 80 }));
    await vi.runAllTimersAsync();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "browser-acp/list-page-task-templates",
    }), expect.any(Function));
    expect(document.querySelector("[data-browser-acp-selection-menu]")).not.toBeNull();
    expect(document.querySelector("[data-browser-acp-selection-action='custom-explain']")?.textContent).toBe("讲讲");
    expect(document.querySelector("[data-browser-acp-selection-action='disabled']")).toBeNull();
  });

  it("dispatches a quick action request with the selected text when a popup action is clicked", async () => {
    const { sendMessage } = createChromeStub();

    await import("../src/content");

    selectTargetText();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 80 }));
    await vi.runAllTimersAsync();

    const explainButton = document.querySelector(
      "[data-browser-acp-selection-action='custom-explain']",
    ) as HTMLButtonElement;
    explainButton.click();

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "browser-acp/trigger-selection-action",
      templateId: "custom-explain",
      selectionText: "Selection test page.",
    });
    expect(document.querySelector("[data-browser-acp-drawer-host]")).toBeNull();
  });

  it("closes the quick action popup after an action is chosen", async () => {
    const { sendMessage } = createChromeStub();

    await import("../src/content");

    selectTargetText();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 80 }));
    await vi.runAllTimersAsync();

    const explainButton = document.querySelector(
      "[data-browser-acp-selection-action='custom-explain']",
    ) as HTMLButtonElement;
    explainButton.click();

    expect(document.querySelector("[data-browser-acp-selection-menu]")).toBeNull();
  });

  it("ignores side panel runtime notifications because the page no longer mounts an in-page drawer", async () => {
    const { dispatchRuntimeMessage } = createChromeStub();

    await import("../src/content");

    dispatchRuntimeMessage({ type: "browser-acp/selection-action-ready" });
    await vi.runAllTimersAsync();

    expect(document.querySelector("[data-browser-acp-drawer-host]")).toBeNull();
    expect(document.documentElement.dataset.browserAcpSplitOpen).toBeUndefined();
  });
});
