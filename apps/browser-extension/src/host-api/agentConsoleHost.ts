import type {
  BrowserContextBundle,
  PromptEnvelope,
  SessionSocketServerMessage,
} from "@browser-acp/shared-types";
import type {
  AgentConsoleHost as BaseAgentConsoleHost,
  AgentConsoleSession as BaseAgentConsoleSession,
} from "@browser-acp/host-api";
import type { BackgroundDebugState, PendingSelectionAction } from "../messages";

export type AgentConsoleSession = BaseAgentConsoleSession<
  PromptEnvelope,
  SessionSocketServerMessage
>;

export type AgentConsoleHost = BaseAgentConsoleHost<
  BrowserContextBundle,
  BackgroundDebugState,
  PendingSelectionAction,
  PromptEnvelope,
  SessionSocketServerMessage
>;

export type BrowserAcpSocket = AgentConsoleSession;
export type BrowserAcpBridge = AgentConsoleHost;
