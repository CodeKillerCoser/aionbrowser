import { describe, expect, it, vi } from "vitest";
import type { PromptEnvelope } from "@browser-acp/shared-types";
import { createChromeBridge } from "../src/sidepanel/bridge";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  send(payload: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("socket not open");
    }

    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event?: unknown): void {
    if (type === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("createChromeBridge", () => {
  it("claims a pending selection action through the background request bridge", async () => {
    const sendMessage = vi.fn((message, callback: (response: unknown) => void) => {
      callback({
        id: "action-1",
        action: "explain",
        selectionText: "Beta",
        promptText: "Explain\n\nBeta",
        createdAt: "2026-04-08T13:00:00.000Z",
      });
    });
    const addListener = vi.fn();
    const removeListener = vi.fn();

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        lastError: undefined,
        onMessage: {
          addListener,
          removeListener,
        },
      },
    });

    const bridge = createChromeBridge();
    const action = await bridge.claimPendingSelectionAction();

    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "browser-acp/claim-pending-selection-action",
      },
      expect.any(Function),
    );
    expect(action).toEqual({
      id: "action-1",
      action: "explain",
      selectionText: "Beta",
      promptText: "Explain\n\nBeta",
      createdAt: "2026-04-08T13:00:00.000Z",
    });
  });

  it("subscribes to quick action notifications from the background runtime bridge", () => {
    let listener: ((message: { type: string }) => void) | undefined;
    const sendMessage = vi.fn();
    const addListener = vi.fn((nextListener) => {
      listener = nextListener;
    });
    const removeListener = vi.fn();

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        lastError: undefined,
        onMessage: {
          addListener,
          removeListener,
        },
      },
    });

    const bridge = createChromeBridge();
    const onQuickAction = vi.fn();
    const unsubscribe = bridge.subscribeToSelectionActions(onQuickAction);

    listener?.({
      type: "browser-acp/selection-action-ready",
    });

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(onQuickAction).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("queues prompts until the websocket opens", () => {
    const socket = new FakeWebSocket("ws://127.0.0.1:9000");
    const webSocketConstructor = vi.fn(() => socket);
    vi.stubGlobal("WebSocket", webSocketConstructor);

    const bridge = createChromeBridge();
    const prompt: PromptEnvelope = {
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Hello",
      context: {
        tabId: 1,
        title: "Page",
        url: "https://example.com",
        selectionText: "",
        summaryMarkdown: "",
        openTabsPreview: [],
        capturedAt: "2026-04-08T03:00:00.000Z",
      },
    };

    const session = bridge.connectSession(
      {
        ok: true,
        port: 9000,
        token: "token",
      },
      "session-1",
      vi.fn(),
      vi.fn(),
    );

    session.sendPrompt(prompt);
    expect(socket.sent).toEqual([]);

    socket.emit("open");

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "sendPrompt",
      prompt,
    });
  });
});
