import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  PermissionDecision,
  PermissionOptionSummary,
  PromptEnvelope,
  SessionEvent,
  ToolCallContentSummary,
  ToolCallSnapshot,
} from "@browser-acp/shared-types";
import type { DebugLogger } from "../debug/logger.js";
import { createBrowserContextFileReference } from "../runtime/browserContextFiles.js";
import { buildPromptText } from "./prompt.js";

type EventSink = (event: SessionEvent) => Promise<void>;

export interface RuntimeSessionCreateInput {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onEvent: EventSink;
  logger?: DebugLogger;
  newSessionAdditionalDirectories?: string[];
  newSessionMeta?: Record<string, unknown>;
  newSessionSettings?: Record<string, unknown>;
  promptPrefix?: string;
  resumeSessionId?: string;
}

export interface RuntimeSessionLike {
  readonly sessionId: string;
  prompt(prompt: PromptEnvelope, turnId: string): Promise<{ stopReason: string }>;
  resolvePermission(decision: PermissionDecision): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export class RuntimeSession implements RuntimeSessionLike {
  readonly sessionId: string;

  private constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly connection: acp.ClientSideConnection,
    private readonly client: RuntimeClient,
    private readonly logger: DebugLogger | undefined,
    private readonly cwd: string,
    private readonly promptPrefix: string | undefined,
    sessionId: string,
    private readonly agentSessionId: string,
  ) {
    this.sessionId = sessionId;
  }

  static async create(input: RuntimeSessionCreateInput): Promise<RuntimeSession> {
    input.logger?.log("runtime", "runtime session spawn started", {
      cwd: input.cwd,
      command: input.command,
      args: input.args,
      envKeys: input.env ? Object.keys(input.env) : [],
      resumeSessionId: input.resumeSessionId,
    });
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...input.env,
      },
    });
    registerChildDebugLogging(child, input.logger);

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!),
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );

    const browserSessionId = input.resumeSessionId ?? "pending-session";
    const client = new RuntimeClient(browserSessionId, input.onEvent, input.logger);
    const connection = new acp.ClientSideConnection(() => client, stream);

    try {
      input.logger?.log("runtime", "runtime connection initialize started");
      const initializeResponse = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      input.logger?.log("runtime", "runtime connection initialize completed");

      const session = input.resumeSessionId
        ? await restoreSession(connection, initializeResponse.agentCapabilities, input)
        : await createNewSession(connection, input);
      client.setBrowserSessionId(input.resumeSessionId ?? session.sessionId);

      return new RuntimeSession(
        child,
        connection,
        client,
        input.logger,
        input.cwd,
        input.promptPrefix,
        input.resumeSessionId ?? session.sessionId,
        session.sessionId,
      );
    } catch (error) {
      input.logger?.log("runtime", "runtime session startup failed", error);
      if (!child.killed) {
        child.kill();
      }
      throw error;
    }
  }

  async prompt(prompt: PromptEnvelope, turnId: string): Promise<acp.PromptResponse> {
    const browserContextPath = await createBrowserContextFileReference({
      cwd: this.cwd,
      sessionId: this.sessionId,
      turnId,
      context: prompt.context,
    });
    const promptText = buildPromptText(prompt, {
      browserContextPath,
      promptPrefix: this.promptPrefix,
    });

    this.logger?.log("runtime", "runtime prompt dispatched", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      turnId,
      textLength: prompt.text.length,
      browserContextPath,
    });
    this.logger?.log("runtime", "runtime prompt content prepared", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      turnId,
      browserContextPath,
      promptText,
    });
    this.client.beginTurn(turnId);
    try {
      const response = await this.connection.prompt({
        sessionId: this.agentSessionId,
        prompt: [
          {
            type: "text",
            text: promptText,
          },
        ],
      });
      this.logger?.log("runtime", "runtime prompt resolved", {
        sessionId: this.sessionId,
        turnId,
        stopReason: response.stopReason,
      });
      return response;
    } catch (error) {
      this.logger?.log("runtime", "runtime prompt failed", error);
      throw error;
    } finally {
      this.client.endTurn(turnId);
    }
  }

  async cancel(): Promise<void> {
    this.logger?.log("runtime", "runtime cancel requested", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
    });
    await this.client.cancelPendingPermissions();
    await this.connection.cancel({
      sessionId: this.agentSessionId,
    });
  }

  async resolvePermission(decision: PermissionDecision): Promise<void> {
    await this.client.resolvePermission(decision);
  }

  async dispose(): Promise<void> {
    this.logger?.log("runtime", "runtime dispose requested", {
      sessionId: this.sessionId,
      childKilled: this.child.killed,
    });
    await this.client.cancelPendingPermissions();
    if (!this.child.killed) {
      this.child.kill();
    }
    await this.connection.closed.catch(() => undefined);
  }
}

class RuntimeClient implements acp.Client {
  private browserSessionId: string;
  private activeTurnId: string | null = null;
  private readonly pendingPermissions = new Map<
    string,
    {
      createdAt: string;
      turnId: string | null;
      toolCall: ToolCallSnapshot;
      options: PermissionOptionSummary[];
      resolve: (response: acp.RequestPermissionResponse) => void;
    }
  >();

  constructor(
    browserSessionId: string,
    private readonly onEvent: EventSink,
    private readonly logger?: DebugLogger,
  ) {
    this.browserSessionId = browserSessionId;
  }

  setBrowserSessionId(sessionId: string): void {
    this.browserSessionId = sessionId;
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
  }

  endTurn(turnId: string): void {
    if (this.activeTurnId === turnId) {
      this.activeTurnId = null;
    }
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const permissionId = randomUUID();
    const createdAt = new Date().toISOString();
    const toolCall = toToolCallSnapshot(params.toolCall);
    const options = params.options.map(toPermissionOptionSummary);

    await this.onEvent({
      type: "permission.requested",
      sessionId: this.browserSessionId,
      turnId: this.activeTurnId,
      permissionId,
      createdAt,
      toolCall,
      options,
    });

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.pendingPermissions.set(permissionId, {
        createdAt,
        turnId: this.activeTurnId,
        toolCall,
        options,
        resolve,
      });
    });
  }

  async resolvePermission(decision: PermissionDecision): Promise<void> {
    const pending = this.pendingPermissions.get(decision.permissionId);
    if (!pending) {
      throw new Error(`Permission request ${decision.permissionId} was not found`);
    }

    if (decision.outcome === "selected") {
      const selected = pending.options.find((option) => option.optionId === decision.optionId);
      if (!selected) {
        throw new Error(`Permission option ${decision.optionId ?? "unknown"} was not found`);
      }

      this.pendingPermissions.delete(decision.permissionId);
      await this.onEvent({
        type: "permission.resolved",
        sessionId: this.browserSessionId,
        turnId: pending.turnId,
        permissionId: decision.permissionId,
        createdAt: new Date().toISOString(),
        toolCallId: pending.toolCall.toolCallId,
        outcome: "selected",
        selectedOption: selected,
      });
      pending.resolve({
        outcome: {
          outcome: "selected",
          optionId: selected.optionId,
        },
      });
      return;
    }

    this.pendingPermissions.delete(decision.permissionId);
    await this.onEvent({
      type: "permission.resolved",
      sessionId: this.browserSessionId,
      turnId: pending.turnId,
      permissionId: decision.permissionId,
      createdAt: new Date().toISOString(),
      toolCallId: pending.toolCall.toolCallId,
      outcome: "cancelled",
      selectedOption: null,
    });
    pending.resolve({
      outcome: {
        outcome: "cancelled",
      },
    });
  }

  async cancelPendingPermissions(): Promise<void> {
    const pendingEntries = [...this.pendingPermissions.entries()];
    this.pendingPermissions.clear();

    await Promise.all(
      pendingEntries.map(async ([permissionId, pending]) => {
        await this.onEvent({
          type: "permission.resolved",
          sessionId: this.browserSessionId,
          turnId: pending.turnId,
          permissionId,
          createdAt: new Date().toISOString(),
          toolCallId: pending.toolCall.toolCallId,
          outcome: "cancelled",
          selectedOption: null,
        });
        pending.resolve({
          outcome: {
            outcome: "cancelled",
          },
        });
      }),
    );
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;
    const content =
      "content" in update && update.content && !Array.isArray(update.content)
        ? update.content
        : undefined;
    const textChunk = content?.type === "text" ? content.text : "";
    this.logger?.log("runtime", "runtime session update received", {
      sessionId: params.sessionId,
      updateKind: update.sessionUpdate,
      contentType: content?.type,
      textPreview: textChunk ? textChunk.slice(0, 120) : undefined,
      turnId: this.activeTurnId,
      messageId: "messageId" in update ? update.messageId : undefined,
    });

    if (update.sessionUpdate === "tool_call") {
      await this.onEvent({
        type: "tool.call",
        sessionId: this.browserSessionId,
        turnId: this.activeTurnId,
        createdAt: new Date().toISOString(),
        toolCall: toToolCallSnapshot(update),
      });
      return;
    }

    if (update.sessionUpdate === "tool_call_update") {
      await this.onEvent({
        type: "tool.call.update",
        sessionId: this.browserSessionId,
        turnId: this.activeTurnId,
        createdAt: new Date().toISOString(),
        toolCall: toToolCallSnapshot(update),
      });
      return;
    }

    await this.onEvent({
      type: "turn.delta",
      sessionId: this.browserSessionId,
      turnId: this.activeTurnId,
      chunk: textChunk,
      role: getEventRole(update.sessionUpdate),
      updateKind: update.sessionUpdate,
      contentType: content?.type,
      messageId: "messageId" in update ? (update.messageId ?? null) : undefined,
    });
  }
}

function getEventRole(updateKind: string): "agent" | "system" | "user" {
  if (updateKind === "agent_message_chunk") {
    return "agent";
  }

  if (updateKind === "user_message_chunk") {
    return "user";
  }

  return "system";
}

function toPermissionOptionSummary(option: acp.PermissionOption): PermissionOptionSummary {
  return {
    optionId: option.optionId,
    kind: option.kind,
    name: option.name,
  };
}

function toToolCallSnapshot(toolCall: acp.ToolCall | acp.ToolCallUpdate): ToolCallSnapshot {
  return {
    toolCallId: toolCall.toolCallId,
    title: "title" in toolCall ? toolCall.title ?? null : null,
    kind: toolCall.kind ?? null,
    status: toolCall.status ?? null,
    locations:
      toolCall.locations?.map((location) => ({
        path: location.path,
        line: location.line ?? null,
      })) ?? null,
    rawInput: toolCall.rawInput,
    rawOutput: toolCall.rawOutput,
    content: toolCall.content?.map(toToolCallContentSummary) ?? null,
  };
}

function toToolCallContentSummary(content: acp.ToolCallContent): ToolCallContentSummary {
  if (content.type === "diff") {
    return {
      type: "diff",
      path: content.path,
      oldText: content.oldText ?? null,
      newText: content.newText,
    };
  }

  if (content.type === "terminal") {
    return {
      type: "terminal",
      terminalId: content.terminalId,
    };
  }

  return toContentBlockSummary(content.content);
}

function toContentBlockSummary(content: acp.ContentBlock): ToolCallContentSummary {
  switch (content.type) {
    case "text":
      return {
        type: "text",
        text: content.text,
      };
    case "image":
      return {
        type: "image",
        mimeType: content.mimeType,
      };
    case "audio":
      return {
        type: "audio",
        mimeType: content.mimeType,
      };
    case "resource_link":
      return {
        type: "resource_link",
        uri: content.uri,
        name: content.name,
        title: content.title ?? undefined,
        mimeType: content.mimeType ?? undefined,
      };
    case "resource":
      return {
        type: "resource",
        uri: content.resource.uri,
        name:
          "name" in content.resource && typeof content.resource.name === "string"
            ? content.resource.name
            : undefined,
        mimeType: content.resource.mimeType ?? undefined,
      };
  }
}

function registerChildDebugLogging(
  child: ReturnType<typeof spawn>,
  logger?: DebugLogger,
): void {
  child.once("spawn", () => {
    logger?.log("runtime", "runtime child spawned", {
      pid: child.pid,
    });
  });

  child.once("error", (error) => {
    logger?.log("runtime", "runtime child process error", error);
  });

  child.once("exit", (code, signal) => {
    logger?.log("runtime", "runtime child exited", {
      code,
      signal,
    });
  });

  child.once("close", (code, signal) => {
    logger?.log("runtime", "runtime child stdio closed", {
      code,
      signal,
    });
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    logger?.log("runtime", "runtime child stderr", {
      chunk: String(chunk),
    });
  });
}

async function createNewSession(
  connection: acp.ClientSideConnection,
  input: RuntimeSessionCreateInput,
): Promise<{ sessionId: string }> {
  input.logger?.log("runtime", "runtime new session started", {
    cwd: input.cwd,
  });
  const session = await connection.newSession(buildSessionRequest(input));
  input.logger?.log("runtime", "runtime new session completed", {
    sessionId: session.sessionId,
  });

  return session;
}

async function restoreSession(
  connection: acp.ClientSideConnection,
  capabilities:
    | {
        loadSession?: boolean;
        sessionCapabilities?: {
          resume?: unknown;
        };
      }
    | undefined,
  input: RuntimeSessionCreateInput,
): Promise<{ sessionId: string }> {
  const sessionId = input.resumeSessionId!;
  const supportsResume = Boolean(capabilities?.sessionCapabilities?.resume);
  const supportsLoad = Boolean(capabilities?.loadSession);

  if (supportsResume) {
    input.logger?.log("runtime", "runtime session resume started", {
      sessionId,
      cwd: input.cwd,
    });
    const resumed = await connection.unstable_resumeSession({
      ...buildSessionRequest(input),
      sessionId,
    });
    input.logger?.log("runtime", "runtime session resume completed", {
      sessionId: resumed.sessionId,
    });

    return resumed;
  }

  if (supportsLoad) {
    input.logger?.log("runtime", "runtime session load started", {
      sessionId,
      cwd: input.cwd,
    });
    const loaded = await connection.loadSession({
      ...buildSessionRequest(input),
      sessionId,
    });
    input.logger?.log("runtime", "runtime session load completed", {
      sessionId: loaded.sessionId,
    });

    return loaded;
  }

  throw new Error(`Agent does not support resuming session ${sessionId}`);
}

type NewSessionRequest = Parameters<acp.ClientSideConnection["newSession"]>[0];

function buildSessionRequest(input: RuntimeSessionCreateInput): NewSessionRequest {
  const request: Record<string, unknown> = {
    _meta: input.newSessionMeta,
    additionalDirectories: input.newSessionAdditionalDirectories,
    cwd: input.cwd,
    mcpServers: [],
  };
  if (input.newSessionSettings) {
    request.settings = input.newSessionSettings;
  }
  return request as NewSessionRequest;
}
