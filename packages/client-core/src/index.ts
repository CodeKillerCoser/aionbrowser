export {
  buildCandidateAgentSpecInput,
  buildManualAgentSpecInput,
  buildUploadedAgentIcon,
  canSaveManualAgentSpec,
  collectRecommendedCandidateIds,
  formatAgentLocalPath,
  getFirstCreatedAgentSpecId,
  getNextSelectedAgentIdAfterDelete,
  parseLaunchArgs,
  selectAgentSpecCandidates,
  toggleCandidateSelection,
} from "./agentSettings.js";

export {
  keepNewerContext,
} from "./contextState.js";

export {
  findActiveAgent,
  findSelectedSession,
  getConversationAgentName,
  getConversationTitle,
  hasRunningAssistantTurn,
  upsertConversationSummary,
} from "./conversationState.js";

export {
  appendDebugLogEntry,
  createDebugLogEntry,
} from "./debugLogs.js";

export {
  getErrorMessage,
} from "./errors.js";

export {
  PENDING_SESSION_ID,
  addOptimisticPrompt,
  createOptimisticPromptId,
  markOptimisticPromptFailed,
  mergeOptimisticPrompts,
  moveOptimisticPromptToSession,
  updateOptimisticPromptContext,
  type OptimisticPrompt,
} from "./optimisticPrompts.js";

export {
  buildPromptEnvelope,
  canSubmitPrompt,
} from "./promptSubmission.js";

export {
  canProcessSelectionAction,
  shouldHandleSelectionActionSignal,
} from "./selectionActions.js";

export {
  appendSessionEvent,
  filterOptimisticPromptsByStartedTurns,
  filterSubmittingPermissionIdsByResolvedEvents,
  getSessionEvents,
  markPermissionSubmitting,
  type EventsBySession,
} from "./sessionEvents.js";

export {
  getNextSessionSocketStatus,
  isSessionSocketUnavailable,
  shouldClearSessionSocketRef,
  shouldFlushPendingPermissions,
  shouldFlushPendingPrompt,
  type SessionSocketStatus,
} from "./sessionSocketState.js";

export {
  buildThreadMessages,
  type TranscriptItem,
  type TranscriptMessageItem,
  type TranscriptPermissionItem,
  type TranscriptThoughtItem,
  type TranscriptToolItem,
} from "./threadMessages.js";
