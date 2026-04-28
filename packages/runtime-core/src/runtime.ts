import type {
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
  ModelState,
} from "@browser-acp/shared-types";

export type RuntimeEventSink = (event: SessionEvent) => Promise<void>;

export interface RuntimeDebugLogger {
  log(scope: string, message: string, details?: unknown): void;
}

export interface RuntimeSessionCreateInput {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onEvent: RuntimeEventSink;
  logger?: RuntimeDebugLogger;
  newSessionAdditionalDirectories?: string[];
  newSessionMeta?: Record<string, unknown>;
  newSessionSettings?: Record<string, unknown>;
  promptPrefix?: string;
  resumeSessionId?: string;
  allowAuthentication?: boolean;
  startupTimeoutMs?: number;
}

export interface RuntimeSessionLike {
  readonly sessionId: string;
  getModelState(): ModelState | null;
  setModel(modelId: string): Promise<ModelState | null>;
  prompt(prompt: PromptEnvelope, turnId: string): Promise<{ stopReason: string }>;
  resolvePermission(decision: PermissionDecision): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeHostCreateInput {
  agent: ResolvedAgent;
  cwd: string;
  resumeSessionId?: string;
  runtime: Omit<RuntimeSessionCreateInput, "command" | "args" | "cwd" | "resumeSessionId">;
}

export interface RuntimeHost {
  create(input: RuntimeHostCreateInput): Promise<RuntimeSessionLike>;
}
