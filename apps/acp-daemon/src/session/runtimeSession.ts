import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { PromptEnvelope, SessionEvent } from "@browser-acp/shared-types";
import type { DebugLogger } from "../debug/logger.js";
import { buildPromptText } from "./prompt.js";

type EventSink = (event: SessionEvent) => Promise<void>;

export interface RuntimeSessionCreateInput {
  cwd: string;
  command: string;
  args: string[];
  onEvent: EventSink;
  logger?: DebugLogger;
  resumeSessionId?: string;
}

export interface RuntimeSessionLike {
  readonly sessionId: string;
  prompt(prompt: PromptEnvelope, turnId: string): Promise<{ stopReason: string }>;
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
      resumeSessionId: input.resumeSessionId,
    });
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
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
    const promptText = buildPromptText(prompt);

    this.logger?.log("runtime", "runtime prompt dispatched", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      turnId,
      textLength: prompt.text.length,
    });
    this.logger?.log("runtime", "runtime prompt content prepared", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      turnId,
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
    await this.connection.cancel({
      sessionId: this.agentSessionId,
    });
  }

  async dispose(): Promise<void> {
    this.logger?.log("runtime", "runtime dispose requested", {
      sessionId: this.sessionId,
      childKilled: this.child.killed,
    });
    if (!this.child.killed) {
      this.child.kill();
    }
    await this.connection.closed.catch(() => undefined);
  }
}

class RuntimeClient implements acp.Client {
  private browserSessionId: string;
  private activeTurnId: string | null = null;

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
    const allowReadOnly = params.toolCall.kind === "read";
    const preferred = params.options.find((option) =>
      allowReadOnly ? option.kind.startsWith("allow") : option.kind.startsWith("reject"),
    );

    if (preferred) {
      return {
        outcome: {
          outcome: "selected",
          optionId: preferred.optionId,
        },
      };
    }

    return {
      outcome: {
        outcome: "cancelled",
      },
    };
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
  const session = await connection.newSession({
    cwd: input.cwd,
    mcpServers: [],
  });
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
      sessionId,
      cwd: input.cwd,
      mcpServers: [],
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
      sessionId,
      cwd: input.cwd,
      mcpServers: [],
    });
    input.logger?.log("runtime", "runtime session load completed", {
      sessionId: loaded.sessionId,
    });

    return loaded;
  }

  throw new Error(`Agent does not support resuming session ${sessionId}`);
}
