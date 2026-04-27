export {
  buildPromptText,
  type BuildPromptTextOptions,
} from "./prompt.js";

export {
  createAgentRegistry,
  specToResolvedAgent,
  type AgentRegistry,
  type AgentSpecRepository,
} from "./agentRegistry.js";

export {
  buildResolvedCatalog,
  getBuiltinRegistryDefaults,
  getDiscoveryCommandCandidates,
  type BuildResolvedCatalogInput,
  type ResolutionRule,
} from "./agentCatalog.js";

export {
  SessionManager,
  type CreateSessionInput,
  type SessionManagerOptions,
  type SessionStoreRepository,
} from "./sessionManager.js";

export type {
  RuntimeDebugLogger,
  RuntimeEventSink,
  RuntimeHost,
  RuntimeHostCreateInput,
  RuntimeSessionCreateInput,
  RuntimeSessionLike,
} from "./runtime.js";
