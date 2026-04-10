import type {
  BrowserContextBundle,
  ConversationSummary,
  NativeHostBootstrapResponse,
  ResolvedAgent,
} from "@browser-acp/shared-types";
import type {
  BackgroundDebugState,
  BackgroundRequest,
  PageContextPayload,
  PendingSelectionAction,
  SelectionActionType,
} from "../messages";

export interface BackgroundRouterServices {
  updateContextFromPage(
    payload: PageContextPayload,
    sender: chrome.runtime.MessageSender,
  ): Promise<{ ok: true }>;
  ensureDaemon(): Promise<NativeHostBootstrapResponse>;
  listAgents(): Promise<ResolvedAgent[]>;
  listSessions(): Promise<ConversationSummary[]>;
  getActiveContext(): Promise<BrowserContextBundle>;
  getDebugState(): Promise<BackgroundDebugState>;
  createSession(
    agentId: string,
    context: BrowserContextBundle,
  ): Promise<ConversationSummary>;
  queueSelectionAction(
    action: SelectionActionType,
    selectionText: string,
    target: { tabId?: number; windowId?: number },
  ): Promise<{ ok: true }>;
  claimPendingSelectionAction(): Promise<PendingSelectionAction | null>;
}

export function createBackgroundRouter(services: BackgroundRouterServices) {
  return {
    async handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
      if (message.type === "browser-acp/context-update") {
        return services.updateContextFromPage(message.payload, sender);
      }

      if (message.type === "browser-acp/ensure-daemon") {
        return services.ensureDaemon();
      }

      if (message.type === "browser-acp/list-agents") {
        return services.listAgents();
      }

      if (message.type === "browser-acp/list-sessions") {
        return services.listSessions();
      }

      if (message.type === "browser-acp/get-active-context") {
        return services.getActiveContext();
      }

      if (message.type === "browser-acp/get-debug-state") {
        return services.getDebugState();
      }

      if (message.type === "browser-acp/create-session") {
        return services.createSession(message.agentId, message.context);
      }

      if (message.type === "browser-acp/trigger-selection-action") {
        return services.queueSelectionAction(message.action, message.selectionText, {
          tabId: sender.tab?.id,
          windowId: sender.tab?.windowId,
        });
      }

      if (message.type === "browser-acp/claim-pending-selection-action") {
        return services.claimPendingSelectionAction();
      }

      return { ok: false, error: "Unsupported message" };
    },
  };
}
