import type {
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextBundle,
  ConversationSummary,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
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
  listAgentSpecs(): Promise<AgentSpec[]>;
  listAgentSpecCandidates(): Promise<AgentSpecCandidate[]>;
  createAgentSpec(input: ExternalAgentSpecInput): Promise<AgentSpec>;
  updateAgentSpec(id: string, patch: ExternalAgentSpecPatch): Promise<AgentSpec>;
  deleteAgentSpec(id: string): Promise<{ ok: true }>;
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

      if (message.type === "browser-acp/list-agent-specs") {
        return services.listAgentSpecs();
      }

      if (message.type === "browser-acp/list-agent-spec-candidates") {
        return services.listAgentSpecCandidates();
      }

      if (message.type === "browser-acp/create-agent-spec") {
        return services.createAgentSpec(message.input);
      }

      if (message.type === "browser-acp/update-agent-spec") {
        return services.updateAgentSpec(message.id, message.patch);
      }

      if (message.type === "browser-acp/delete-agent-spec") {
        return services.deleteAgentSpec(message.id);
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
