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
  launchCommand: string;
  launchArgs: string[];
  installationHint?: string;
  adapterPackage?: string;
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

export interface SessionSocketClientMessage {
  type: "sendPrompt" | "cancelTurn";
  prompt?: PromptEnvelope;
}

export interface SessionSocketServerMessage {
  type: "event" | "error";
  event?: SessionEvent;
  error?: string;
}
