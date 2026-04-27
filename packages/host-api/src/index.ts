import type {
  AgentSpec,
  AgentSpecCandidate,
  ConversationSummary,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionSocketServerMessage,
} from "@browser-acp/shared-types";

export type AgentConsoleSessionStatus = "open" | "close" | "error";

export interface AgentConsoleSession<
  TPrompt = PromptEnvelope,
  TServerMessage = SessionSocketServerMessage,
> {
  sendPrompt(prompt: TPrompt): void;
  resolvePermission(decision: PermissionDecision): void;
  close(): void;
}

export interface AgentConsoleHost<
  TContext = unknown,
  TDebugState = unknown,
  TPendingAction = unknown,
  TPrompt = PromptEnvelope,
  TServerMessage = SessionSocketServerMessage,
> {
  ensureReady(): Promise<void>;
  listAgents(): Promise<ResolvedAgent[]>;
  listAgentSpecs(): Promise<AgentSpec[]>;
  listAgentSpecCandidates(): Promise<AgentSpecCandidate[]>;
  createAgentSpec(input: ExternalAgentSpecInput): Promise<AgentSpec>;
  updateAgentSpec(id: string, patch: ExternalAgentSpecPatch): Promise<AgentSpec>;
  deleteAgentSpec(id: string): Promise<{ ok: true }>;
  listSessions(): Promise<ConversationSummary[]>;
  getActiveContext(): Promise<TContext>;
  subscribeToActiveContext(onContext: (context: TContext) => void): () => void;
  claimPendingSelectionAction(): Promise<TPendingAction | null>;
  subscribeToSelectionActions(onReady: () => void): () => void;
  getDebugState(): Promise<TDebugState>;
  createSession(agentId: string, context: TContext): Promise<ConversationSummary>;
  connectSession(
    sessionId: string,
    onMessage: (message: TServerMessage) => void,
    onError: (error: string) => void,
    onStatus?: (status: AgentConsoleSessionStatus, details?: Record<string, unknown>) => void,
  ): AgentConsoleSession<TPrompt, TServerMessage>;
}
