import type {
  BrowserContextBundle,
  ConversationSummary,
  NativeHostBootstrapResponse,
  PromptEnvelope,
  ResolvedAgent,
  SessionSocketServerMessage,
} from "@browser-acp/shared-types";
import type {
  BackgroundDebugState,
  BackgroundRequest,
  BackgroundRuntimeMessage,
  PendingSelectionAction,
} from "../messages";
import type { BrowserAcpBridge, BrowserAcpSocket } from "./contracts";

export function createChromeBridge(): BrowserAcpBridge {
  return {
    ensureDaemon: () => sendMessage({ type: "browser-acp/ensure-daemon" }),
    listAgents: async () => sendMessage({ type: "browser-acp/list-agents" }),
    listSessions: async () => sendMessage({ type: "browser-acp/list-sessions" }),
    getActiveContext: async () => sendMessage({ type: "browser-acp/get-active-context" }),
    subscribeToActiveContext(onContext: (context: BrowserContextBundle) => void) {
      const listener = (message: BackgroundRuntimeMessage) => {
        if (message.type === "browser-acp/context-changed") {
          onContext(message.context);
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
      };
    },
    claimPendingSelectionAction: async () =>
      sendMessage<PendingSelectionAction | null>({
        type: "browser-acp/claim-pending-selection-action",
      }),
    subscribeToSelectionActions(onReady: () => void) {
      const listener = (message: BackgroundRuntimeMessage) => {
        if (message.type === "browser-acp/selection-action-ready") {
          onReady();
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
      };
    },
    getDebugState: async () => sendMessage<BackgroundDebugState>({ type: "browser-acp/get-debug-state" }),
    createSession: async (_bootstrap: NativeHostBootstrapResponse, agentId: string, context: BrowserContextBundle) =>
      sendMessage({
        type: "browser-acp/create-session",
        agentId,
        context,
      }),
    connectSession: (
      bootstrap: NativeHostBootstrapResponse,
      sessionId: string,
      onMessage: (message: SessionSocketServerMessage) => void,
      onError: (error: string) => void,
      onStatus?: (status: "open" | "close" | "error", details?: Record<string, unknown>) => void,
    ): BrowserAcpSocket => {
      const socket = new WebSocket(`ws://127.0.0.1:${bootstrap.port}/sessions/${sessionId}?token=${bootstrap.token}`);
      const pendingMessages: string[] = [];
      socket.addEventListener("open", () => {
        while (pendingMessages.length > 0) {
          socket.send(pendingMessages.shift()!);
        }
        onStatus?.("open", {
          sessionId,
        });
      });
      socket.addEventListener("message", (event) => {
        onMessage(JSON.parse(event.data) as SessionSocketServerMessage);
      });
      socket.addEventListener("error", () => {
        onStatus?.("error", {
          sessionId,
        });
        onError("WebSocket connection failed.");
      });
      socket.addEventListener("close", (event) => {
        onStatus?.("close", {
          sessionId,
          code: event.code,
          wasClean: event.wasClean,
        });
      });

      return {
        sendPrompt(prompt: PromptEnvelope) {
          const payload = JSON.stringify({
            type: "sendPrompt",
            prompt,
          });

          if (socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
            return;
          }

          pendingMessages.push(payload);
        },
        close() {
          pendingMessages.splice(0, pendingMessages.length);
          socket.close();
        },
      };
    },
  };
}

function sendMessage<T>(message: BackgroundRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      if (
        response &&
        typeof response === "object" &&
        "ok" in response &&
        response.ok === false
      ) {
        const errorMessage =
          ("error" in response && typeof response.error === "string" && response.error) ||
          ("message" in response && typeof response.message === "string" && response.message) ||
          "Browser ACP request failed.";
        reject(new Error(errorMessage));
        return;
      }

      resolve(response as T);
    });
  });
}
