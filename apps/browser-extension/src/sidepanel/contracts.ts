import type {
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextBundle,
  ConversationSummary,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  NativeHostBootstrapResponse,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionSocketServerMessage,
} from "@browser-acp/shared-types";
import type { BackgroundDebugState, PendingSelectionAction } from "../messages";

export interface BrowserAcpSocket {
  sendPrompt(prompt: PromptEnvelope): void;
  resolvePermission(decision: PermissionDecision): void;
  close(): void;
}

export interface BrowserAcpBridge {
  ensureDaemon(): Promise<NativeHostBootstrapResponse>;
  listAgents(bootstrap: NativeHostBootstrapResponse): Promise<ResolvedAgent[]>;
  listAgentSpecs(bootstrap: NativeHostBootstrapResponse): Promise<AgentSpec[]>;
  listAgentSpecCandidates(bootstrap: NativeHostBootstrapResponse): Promise<AgentSpecCandidate[]>;
  createAgentSpec(bootstrap: NativeHostBootstrapResponse, input: ExternalAgentSpecInput): Promise<AgentSpec>;
  updateAgentSpec(
    bootstrap: NativeHostBootstrapResponse,
    id: string,
    patch: ExternalAgentSpecPatch,
  ): Promise<AgentSpec>;
  deleteAgentSpec(bootstrap: NativeHostBootstrapResponse, id: string): Promise<{ ok: true }>;
  listSessions(bootstrap: NativeHostBootstrapResponse): Promise<ConversationSummary[]>;
  getActiveContext(): Promise<BrowserContextBundle>;
  subscribeToActiveContext(onContext: (context: BrowserContextBundle) => void): () => void;
  claimPendingSelectionAction(): Promise<PendingSelectionAction | null>;
  subscribeToSelectionActions(onReady: () => void): () => void;
  getDebugState(): Promise<BackgroundDebugState>;
  createSession(
    bootstrap: NativeHostBootstrapResponse,
    agentId: string,
    context: BrowserContextBundle,
  ): Promise<ConversationSummary>;
  connectSession(
    bootstrap: NativeHostBootstrapResponse,
    sessionId: string,
    onMessage: (message: SessionSocketServerMessage) => void,
    onError: (error: string) => void,
    onStatus?: (status: "open" | "close" | "error", details?: Record<string, unknown>) => void,
  ): BrowserAcpSocket;
}
