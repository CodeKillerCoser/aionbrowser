import type {
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextBundle,
  DebugLogEntry,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  NativeHostBootstrapResponse,
} from "@browser-acp/shared-types";

export interface PageContextPayload {
  url: string;
  title: string;
  selectionText: string;
  summaryMarkdown: string;
  hasFocus: boolean;
}

export type SelectionActionType = "explain" | "search" | "examples";

export interface PendingSelectionAction {
  id: string;
  action: SelectionActionType;
  selectionText: string;
  promptText: string;
  createdAt: string;
}

export type BackgroundDebugLogEntry = DebugLogEntry;

export interface BackgroundDebugState {
  extensionId: string;
  nativeHostName: string;
  daemonBaseUrl: string;
  bootstrapCache: NativeHostBootstrapResponse | null;
  daemonStatus: NativeHostBootstrapResponse | null;
  daemonLogs: DebugLogEntry[];
  logs: BackgroundDebugLogEntry[];
}

export type BackgroundRequest =
  | {
      type: "browser-acp/context-update";
      payload: PageContextPayload;
    }
  | {
      type: "browser-acp/ensure-daemon";
    }
  | {
      type: "browser-acp/list-agents";
    }
  | {
      type: "browser-acp/list-agent-specs";
    }
  | {
      type: "browser-acp/list-agent-spec-candidates";
    }
  | {
      type: "browser-acp/create-agent-spec";
      input: ExternalAgentSpecInput;
    }
  | {
      type: "browser-acp/update-agent-spec";
      id: string;
      patch: ExternalAgentSpecPatch;
    }
  | {
      type: "browser-acp/delete-agent-spec";
      id: string;
    }
  | {
      type: "browser-acp/list-sessions";
    }
  | {
      type: "browser-acp/get-active-context";
    }
  | {
      type: "browser-acp/get-debug-state";
    }
  | {
      type: "browser-acp/create-session";
      agentId: string;
      context: BrowserContextBundle;
    }
  | {
      type: "browser-acp/trigger-selection-action";
      action: SelectionActionType;
      selectionText: string;
    }
  | {
      type: "browser-acp/claim-pending-selection-action";
    };

export type AgentSpecResponse = AgentSpec;
export type AgentSpecCandidateResponse = AgentSpecCandidate;

export type BackgroundRuntimeMessage =
  | {
      type: "browser-acp/context-changed";
      context: BrowserContextBundle;
    }
  | {
      type: "browser-acp/selection-action-ready";
    };
