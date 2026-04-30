export type AgentStatus = "ready" | "launchable" | "needs_adapter" | "unavailable";

export type AgentSource = "registry" | "local-scan" | "user";

export interface AgentDistribution {
  type: "binary" | "npx" | "custom";
  command: string;
  args?: string[];
  packageName?: string;
}

export interface AgentCatalogEntry {
  id: string;
  name: string;
  version?: string;
  description?: string;
  website?: string;
  repository?: string;
  icon?: string;
  source: AgentSource;
  distribution: AgentDistribution;
  defaultCwd?: string;
}

export interface ResolvedAgent extends AgentCatalogEntry {
  status: AgentStatus;
  detectedCommand?: string;
  detectedCommandPath?: string;
  launchCommand: string;
  launchArgs: string[];
  installationHint?: string;
  adapterPackage?: string;
}

export type AgentSpecKind = "external-acp" | "builtin-forge";

export type AgentIconSpec =
  | {
      kind: "url";
      value: string;
    }
  | {
      kind: "uploaded";
      value: string;
    };

export interface AgentSpecBase {
  id: string;
  name: string;
  kind: AgentSpecKind;
  enabled: boolean;
  description?: string;
  icon?: AgentIconSpec;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalAcpAgentSpec extends AgentSpecBase {
  kind: "external-acp";
  launch: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
}

export interface ForgeAgentSpec extends AgentSpecBase {
  kind: "builtin-forge";
  forge: {
    model?: string;
    systemPromptProfile?: string;
    toolset?: string[];
    commandConfig?: Record<string, unknown>;
    workspacePolicy?: Record<string, unknown>;
    permissionPolicy?: Record<string, unknown>;
    shellPolicy?: Record<string, unknown>;
    filesystemPolicy?: Record<string, unknown>;
  };
}

export type AgentSpec = ExternalAcpAgentSpec | ForgeAgentSpec;

export interface ExternalAgentSpecInput {
  name: string;
  launchCommand: string;
  launchArgs: string[];
  icon?: AgentIconSpec;
  enabled?: boolean;
  description?: string;
}

export interface ExternalAgentSpecPatch {
  name?: string;
  launchCommand?: string;
  launchArgs?: string[];
  icon?: AgentIconSpec | null;
  enabled?: boolean;
  description?: string | null;
}

export interface AgentSpecCandidate {
  catalogId: string;
  name: string;
  description?: string;
  icon?: AgentIconSpec;
  launchCommand: string;
  launchArgs: string[];
  detectedCommandPath?: string;
  status: AgentStatus;
  recommended: boolean;
  installationHint?: string;
}

export interface BrowserTabPreview {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserContextBundle {
  tabId: number;
  url: string;
  title: string;
  selectionText: string;
  summaryMarkdown: string;
  openTabsPreview: BrowserTabPreview[];
  capturedAt: string;
}

export interface PageTaskTemplate {
  id: string;
  title: string;
  promptTemplate: string;
  enabled: boolean;
}

export interface BrowserContextTimelineEntry {
  id: string;
  reason: string;
  capturedAt: string;
  context: BrowserContextBundle;
}

export interface DebugLogEntry {
  timestamp: string;
  scope: string;
  message: string;
  details?: unknown;
}

export interface PromptEnvelope {
  sessionId: string;
  agentId: string;
  text: string;
  context: BrowserContextBundle;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string | null;
}

export interface ModelState {
  currentModelId: string;
  availableModels: ModelInfo[];
}

export type AuthMethodType = "agent" | "env_var" | "terminal";

export interface AuthEnvVarSummary {
  name: string;
  label?: string | null;
  optional?: boolean;
  secret?: boolean;
}

export interface AuthMethodSummary {
  id: string;
  type: AuthMethodType;
  name?: string | null;
  description?: string | null;
  link?: string | null;
  vars?: AuthEnvVarSummary[];
  args?: string[];
  env?: Record<string, string>;
}

export type AgentAuthState =
  | "authenticated"
  | "unauthenticated"
  | "not_required"
  | "unavailable"
  | "unknown";

export interface AgentAuthStatus {
  state: AgentAuthState;
  methods: AuthMethodSummary[];
  checkedAt: string;
  error?: string | null;
  models?: ModelState | null;
}

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  pageTitle: string;
  pageUrl: string;
  lastActivityAt: string;
  createdAt: string;
  active: boolean;
  readOnly: boolean;
}

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface ToolCallLocationSummary {
  path: string;
  line?: number | null;
}

export interface ToolCallContentSummary {
  type: "text" | "image" | "audio" | "resource_link" | "resource" | "diff" | "terminal";
  text?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  title?: string;
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
}

export interface ToolCallSnapshot {
  toolCallId: string;
  title?: string | null;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  locations?: ToolCallLocationSummary[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContentSummary[] | null;
}

export interface PermissionOptionSummary {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
}

export interface PermissionDecision {
  permissionId: string;
  outcome: "selected" | "cancelled";
  optionId?: string;
}

export type SessionEvent =
  | {
      type: "session.started";
      sessionId: string;
      summary: ConversationSummary;
    }
  | {
      type: "turn.started";
      sessionId: string;
      turnId: string;
      prompt: string;
      startedAt: string;
    }
  | {
      type: "turn.delta";
      sessionId: string;
      turnId: string | null;
      chunk: string;
      role: "agent" | "system" | "user";
      updateKind: string;
      contentType?: string;
      messageId?: string | null;
    }
  | {
      type: "turn.completed";
      sessionId: string;
      turnId: string;
      stopReason: string;
      completedAt: string;
    }
  | {
      type: "turn.failed";
      sessionId: string;
      turnId: string;
      error: string;
      failedAt: string;
    }
  | {
      type: "agent.stateChanged";
      sessionId: string;
      state: "starting" | "ready" | "stopped" | "error";
      detail?: string;
      changedAt: string;
    }
  | {
      type: "context.attached";
      sessionId: string;
      turnId: string;
      context: BrowserContextBundle;
    }
  | {
      type: "tool.call";
      sessionId: string;
      turnId: string | null;
      createdAt: string;
      toolCall: ToolCallSnapshot;
    }
  | {
      type: "tool.call.update";
      sessionId: string;
      turnId: string | null;
      createdAt: string;
      toolCall: ToolCallSnapshot;
    }
  | {
      type: "permission.requested";
      sessionId: string;
      turnId: string | null;
      permissionId: string;
      createdAt: string;
      toolCall: ToolCallSnapshot;
      options: PermissionOptionSummary[];
    }
  | {
      type: "permission.resolved";
      sessionId: string;
      turnId: string | null;
      permissionId: string;
      createdAt: string;
      toolCallId: string;
      outcome: "selected" | "cancelled";
      selectedOption?: PermissionOptionSummary | null;
    };

export interface NativeHostBootstrapRequest {
  command: "ensureDaemon" | "getDaemonStatus" | "openLogs";
}

export interface NativeHostBootstrapResponse {
  ok: boolean;
  port?: number;
  token?: string;
  pid?: number;
  logPath?: string;
  message?: string;
}

export type SessionSocketClientMessage =
  | {
      type: "sendPrompt";
      prompt: PromptEnvelope;
    }
  | {
      type: "cancelTurn";
    }
  | {
      type: "resolvePermission";
      decision: PermissionDecision;
    };

export interface SessionSocketServerMessage {
  type: "event" | "error";
  event?: SessionEvent;
  error?: string;
}
