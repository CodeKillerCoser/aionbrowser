import type {
  AgentSpec,
  AgentSpecCandidate,
  AgentAuthStatus,
  BrowserContextTimelineEntry,
  ConversationSummary,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  ModelState,
  PageTaskTemplate,
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
  listPageTaskTemplates(): Promise<PageTaskTemplate[]>;
  updatePageTaskTemplates(templates: PageTaskTemplate[]): Promise<{ ok: true }>;
  listContextHistory(): Promise<BrowserContextTimelineEntry[]>;
  claimPendingSelectionAction(): Promise<TPendingAction | null>;
  subscribeToSelectionActions(onReady: () => void): () => void;
  getDebugState(): Promise<TDebugState>;
  createSession(agentId: string, context: TContext): Promise<ConversationSummary>;
  renameSession(sessionId: string, title: string): Promise<ConversationSummary>;
  deleteSession(sessionId: string): Promise<{ ok: true }>;
  getAgentModels(agentId: string): Promise<ModelState | null>;
  getAgentAuthStatus(agentId: string): Promise<AgentAuthStatus>;
  authenticateAgent(agentId: string, methodId?: string, env?: Record<string, string>): Promise<AgentAuthStatus>;
  getSessionModels(sessionId: string): Promise<ModelState | null>;
  setSessionModel(sessionId: string, modelId: string): Promise<ModelState | null>;
  connectSession(
    sessionId: string,
    onMessage: (message: TServerMessage) => void,
    onError: (error: string) => void,
    onStatus?: (status: AgentConsoleSessionStatus, details?: Record<string, unknown>) => void,
  ): AgentConsoleSession<TPrompt, TServerMessage>;
}
