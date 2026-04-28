import { EXTENSION_STORAGE_KEYS, createDaemonBaseUrl } from "@browser-acp/config";
import type {
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextTimelineEntry,
  BrowserContextBundle,
  ConversationSummary,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  ModelState,
  NativeHostBootstrapResponse,
  PageTaskTemplate,
  PermissionDecision,
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
import type { AgentConsoleHost, AgentConsoleSession } from "../host-api/agentConsoleHost";

type ReadyBootstrap = NativeHostBootstrapResponse & {
  ok: true;
  port: number;
  token: string;
};

export function createChromeBridge(): AgentConsoleHost {
  let bootstrapCache: ReadyBootstrap | null = null;

  async function ensureReady(): Promise<void> {
    const bootstrap = await sendMessage<NativeHostBootstrapResponse>({
      type: "browser-acp/ensure-daemon",
    });
    if (!bootstrap.ok || bootstrap.port === undefined || !bootstrap.token) {
      throw new Error(bootstrap.message ?? "Daemon bootstrap is incomplete.");
    }
    bootstrapCache = bootstrap as ReadyBootstrap;
  }

  function requireBootstrap(): ReadyBootstrap {
    if (!bootstrapCache?.ok || bootstrapCache.port === undefined || !bootstrapCache.token) {
      throw new Error("Agent console host is not ready.");
    }
    return bootstrapCache;
  }

  return {
    ensureReady,
    listAgents: async () => sendMessage({ type: "browser-acp/list-agents" }),
    listAgentSpecs: async () => sendMessage<AgentSpec[]>({ type: "browser-acp/list-agent-specs" }),
    listAgentSpecCandidates: async () =>
      sendMessage<AgentSpecCandidate[]>({ type: "browser-acp/list-agent-spec-candidates" }),
    createAgentSpec: async (input: ExternalAgentSpecInput) =>
      sendMessage<AgentSpec>({
        type: "browser-acp/create-agent-spec",
        input,
      }),
    updateAgentSpec: async (id: string, patch: ExternalAgentSpecPatch) =>
      sendMessage<AgentSpec>({
        type: "browser-acp/update-agent-spec",
        id,
        patch,
      }),
    deleteAgentSpec: async (id: string) =>
      sendMessage<{ ok: true }>({
        type: "browser-acp/delete-agent-spec",
        id,
      }),
    listSessions: async () => sendMessage({ type: "browser-acp/list-sessions" }),
    getActiveContext: async () => sendMessage({ type: "browser-acp/get-active-context" }),
    listPageTaskTemplates: async () =>
      sendMessage<PageTaskTemplate[]>({ type: "browser-acp/list-page-task-templates" }),
    updatePageTaskTemplates: async (templates: PageTaskTemplate[]) =>
      sendMessage<{ ok: true }>({
        type: "browser-acp/update-page-task-templates",
        templates,
      }),
    listContextHistory: async () =>
      sendMessage<BrowserContextTimelineEntry[]>({ type: "browser-acp/list-context-history" }),
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
      const runtimeListener = (message: BackgroundRuntimeMessage) => {
        if (message.type === "browser-acp/selection-action-ready") {
          onReady();
        }
      };
      const storageListener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName !== "local") {
          return;
        }

        const pendingSelectionActionChange = changes[EXTENSION_STORAGE_KEYS.pendingSelectionAction];
        if (pendingSelectionActionChange?.newValue) {
          onReady();
        }
      };

      chrome.runtime.onMessage.addListener(runtimeListener);
      chrome.storage?.onChanged?.addListener?.(storageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(runtimeListener);
        chrome.storage?.onChanged?.removeListener?.(storageListener);
      };
    },
    getDebugState: async () => sendMessage<BackgroundDebugState>({ type: "browser-acp/get-debug-state" }),
    createSession: async (agentId: string, context: BrowserContextBundle) =>
      sendMessage({
        type: "browser-acp/create-session",
        agentId,
        context,
      }),
    renameSession: async (sessionId: string, title: string) =>
      sendMessage<ConversationSummary>({
        type: "browser-acp/rename-session",
        sessionId,
        title,
      }),
    deleteSession: async (sessionId: string) =>
      sendMessage<{ ok: true }>({
        type: "browser-acp/delete-session",
        sessionId,
      }),
    getAgentModels: async (agentId: string) =>
      sendMessage<ModelState | null>({
        type: "browser-acp/get-agent-models",
        agentId,
      }),
    getSessionModels: async (sessionId: string) =>
      sendMessage<ModelState | null>({
        type: "browser-acp/get-session-models",
        sessionId,
      }),
    setSessionModel: async (sessionId: string, modelId: string) =>
      sendMessage<ModelState | null>({
        type: "browser-acp/set-session-model",
        sessionId,
        modelId,
      }),
    connectSession: (
      sessionId: string,
      onMessage: (message: SessionSocketServerMessage) => void,
      onError: (error: string) => void,
      onStatus?: (status: "open" | "close" | "error", details?: Record<string, unknown>) => void,
    ): AgentConsoleSession => {
      const bootstrap = requireBootstrap();

      const websocketUrl = new URL(`/sessions/${sessionId}`, createDaemonBaseUrl(bootstrap.port));
      websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
      websocketUrl.searchParams.set("token", bootstrap.token);
      const socket = new WebSocket(websocketUrl.toString());
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
        resolvePermission(decision: PermissionDecision) {
          const payload = JSON.stringify({
            type: "resolvePermission",
            decision,
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
