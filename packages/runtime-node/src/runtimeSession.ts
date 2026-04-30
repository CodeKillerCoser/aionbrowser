import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Transform, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AuthEnvVarSummary,
  AuthMethodSummary,
  PermissionDecision,
  PermissionOptionSummary,
  PromptEnvelope,
  ModelState,
  ToolCallContentSummary,
  ToolCallSnapshot,
} from "@browser-acp/shared-types";
import { createBrowserContextFileReference } from "./browserContextFiles.js";
import {
  buildPromptText,
  RuntimeAuthenticationRequiredError,
  type RuntimeDebugLogger,
  type RuntimeSessionCreateInput,
  type RuntimeSessionLike,
} from "@browser-acp/runtime-core";

export class RuntimeSession implements RuntimeSessionLike {
  readonly sessionId: string;

  private constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly connection: acp.ClientSideConnection,
    private readonly client: RuntimeClient,
    private readonly logger: RuntimeDebugLogger | undefined,
    private readonly cwd: string,
    private readonly promptPrefix: string | undefined,
    sessionId: string,
    private readonly agentSessionId: string,
    private modelState: ModelState | null,
    private readonly authMethods: AuthMethodSummary[],
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
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...input.env,
      },
    });
    const stderrChunks: string[] = [];
    registerChildDebugLogging(child, input.logger, stderrChunks);

    const outboundAcpLog = createAcpPacketLoggingTransform("sent", input.logger);
    const inboundAcpLog = createAcpPacketLoggingTransform("received", input.logger);
    outboundAcpLog.pipe(child.stdin!);
    child.stdout!.pipe(inboundAcpLog);

    const stream = acp.ndJsonStream(
      Writable.toWeb(outboundAcpLog),
      Readable.toWeb(inboundAcpLog) as ReadableStream<Uint8Array>,
    );

    const browserSessionId = input.resumeSessionId ?? "pending-session";
    const client = new RuntimeClient(browserSessionId, input.onEvent, input.logger);
    const connection = new acp.ClientSideConnection(() => client, stream);

    try {
      const session = await withStartupTimeout(
        (async () => {
          input.logger?.log("runtime", "runtime connection initialize started");
          const initializeResponse = await connection.initialize({
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {},
          });
          input.logger?.log("runtime", "runtime connection initialize completed", {
            authMethodCount: initializeResponse.authMethods?.length ?? 0,
          });

          const authMethods = normalizeAuthMethods(initializeResponse.authMethods);
          input.logger?.log("runtime", "runtime auth methods normalized", {
            authMethods: authMethods.map((method) => ({
              id: method.id,
              type: method.type,
              varNames: method.vars?.map((variable) => variable.name).join(", ") ?? null,
            })),
          });
          const sessionResponse = input.resumeSessionId
            ? await restoreSession(connection, initializeResponse.agentCapabilities, initializeResponse.authMethods, input)
            : await createNewSession(connection, initializeResponse.authMethods, input);

          return {
            authMethods,
            session: sessionResponse,
          };
        })(),
        input.startupTimeoutMs,
        () => {
          input.logger?.log("runtime", "runtime session startup timed out", {
            timeoutMs: input.startupTimeoutMs,
          });
          terminateRuntimeProcess(child, input.logger);
        },
      );
      client.setBrowserSessionId(input.resumeSessionId ?? session.session.sessionId);

      return new RuntimeSession(
        child,
        connection,
        client,
        input.logger,
        input.cwd,
        input.promptPrefix,
        input.resumeSessionId ?? session.session.sessionId,
        session.session.sessionId,
        normalizeModelState(session.session.models),
        session.authMethods,
      );
    } catch (error) {
      const failure = enrichRuntimeError(error, stderrChunks);
      input.logger?.log("runtime", "runtime session startup failed", failure);
      terminateRuntimeProcess(child, input.logger);
      throw failure;
    }
  }

  getModelState(): ModelState | null {
    return this.modelState;
  }

  getAuthMethods(): AuthMethodSummary[] {
    return this.authMethods;
  }

  async setModel(modelId: string): Promise<ModelState | null> {
    this.logger?.log("runtime", "runtime set session model requested", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      modelId,
    });
    const response = await this.connection.unstable_setSessionModel({
      sessionId: this.agentSessionId,
      modelId,
    });
    const responseModels = normalizeModelState(
      (response as { models?: unknown } | undefined)?.models,
    );

    if (responseModels) {
      this.modelState = responseModels;
    } else if (this.modelState) {
      this.modelState = {
        ...this.modelState,
        currentModelId: modelId,
      };
    }

    this.logger?.log("runtime", "runtime set session model completed", {
      sessionId: this.sessionId,
      agentSessionId: this.agentSessionId,
      modelId: this.modelState?.currentModelId ?? modelId,
    });

    return this.modelState;
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
    terminateRuntimeProcess(this.child, this.logger);
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
    private readonly onEvent: RuntimeSessionCreateInput["onEvent"],
    private readonly logger?: RuntimeDebugLogger,
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
  logger?: RuntimeDebugLogger,
  stderrChunks: string[] = [],
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
    stderrChunks.push(String(chunk));
    while (stderrChunks.length > 6) {
      stderrChunks.shift();
    }
    logger?.log("runtime", "runtime child stderr", {
      chunk: String(chunk),
    });
  });
}

type AcpPacketDirection = "sent" | "received";

function createAcpPacketLoggingTransform(direction: AcpPacketDirection, logger?: RuntimeDebugLogger): Transform {
  let pending = "";

  return new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
      if (logger) {
        pending += buffer.toString("utf8");
        let newlineIndex = pending.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = pending.slice(0, newlineIndex).trim();
          pending = pending.slice(newlineIndex + 1);
          logAcpPacketLine(logger, direction, line);
          newlineIndex = pending.indexOf("\n");
        }
      }
      callback(null, buffer);
    },
    flush(callback) {
      if (logger && pending.trim()) {
        logAcpPacketLine(logger, direction, pending.trim());
      }
      callback();
    },
  });
}

function logAcpPacketLine(logger: RuntimeDebugLogger, direction: AcpPacketDirection, line: string): void {
  if (!line) {
    return;
  }

  try {
    logger.log("runtime", `runtime acp packet ${direction}`, {
      direction,
      packet: sanitizeAcpLogValue(JSON.parse(line)),
    });
  } catch {
    logger.log("runtime", `runtime acp packet ${direction}`, {
      direction,
      rawLine: truncateLogString(line),
      parseError: "Invalid JSON line",
    });
  }
}

const MAX_ACP_LOG_STRING_LENGTH = 2_000;
const MAX_ACP_LOG_ARRAY_LENGTH = 40;
const MAX_ACP_LOG_DEPTH = 8;

function sanitizeAcpLogValue(value: unknown, parentKey?: string, depth = 0): unknown {
  if (parentKey && shouldRedactAcpLogKey(parentKey)) {
    return redactAcpLogValue(value);
  }
  if (depth > MAX_ACP_LOG_DEPTH) {
    return "[MaxDepth]";
  }
  if (typeof value === "string") {
    return truncateLogString(value);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ACP_LOG_ARRAY_LENGTH)
      .map((entry) => sanitizeAcpLogValue(entry, parentKey, depth + 1));
    if (value.length > MAX_ACP_LOG_ARRAY_LENGTH) {
      sanitized.push(`[${value.length - MAX_ACP_LOG_ARRAY_LENGTH} more items]`);
    }
    return sanitized;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sanitizeAcpLogValue(entry, key, depth + 1);
  }
  return output;
}

function redactAcpLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(() => "[REDACTED]");
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value).map((key) => [key, "[REDACTED]"]));
  }
  return "[REDACTED]";
}

function shouldRedactAcpLogKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization"
    || normalized === "cookie"
    || normalized === "set-cookie"
    || normalized === "env"
    || normalized.includes("api_key")
    || normalized.includes("apikey")
    || normalized.includes("access_token")
    || normalized.includes("refresh_token")
    || normalized.includes("secret")
    || normalized.includes("password")
    || normalized.includes("credential")
    || normalized.endsWith("token");
}

function truncateLogString(value: string): string {
  if (value.length <= MAX_ACP_LOG_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ACP_LOG_STRING_LENGTH)}...[truncated ${value.length - MAX_ACP_LOG_STRING_LENGTH} chars]`;
}

function enrichRuntimeError(error: unknown, stderrChunks: string[]): unknown {
  if (error instanceof RuntimeAuthenticationRequiredError) {
    return error;
  }

  const originalMessage = error instanceof Error ? error.message : String(error);
  const acpDetails = extractAcpErrorDetails(error);
  let message = acpDetails && isGenericAcpErrorMessage(originalMessage)
    ? acpDetails
    : originalMessage;
  if (acpDetails && !message.includes(acpDetails)) {
    message = `${message}\n\n${acpDetails}`;
  }
  message = message.replace(/qodercli \/login/g, "qodercli login");
  const stderrHint = extractRuntimeStderrHint(stderrChunks);
  if (stderrHint && !message.includes(stderrHint)) {
    message = `${message}\n\n${stderrHint}`;
  }

  if (message === originalMessage) {
    return error;
  }

  const enriched = new Error(message);
  enriched.name = error instanceof Error ? error.name : "Error";
  enriched.cause = error;
  return enriched;
}

function extractAcpErrorDetails(error: unknown): string | null {
  if (!(error instanceof acp.RequestError)) {
    return null;
  }

  const data = error.data;
  if (typeof data === "string") {
    return data;
  }
  if (!data || typeof data !== "object") {
    return null;
  }

  const details = (data as { details?: unknown }).details;
  if (typeof details === "string" && details.trim().length > 0) {
    return details.trim();
  }

  const message = (data as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }

  return null;
}

function isGenericAcpErrorMessage(message: string): boolean {
  return message === "Internal error" || message === "Invalid params" || message === "Invalid request";
}

function extractRuntimeStderrHint(stderrChunks: string[]): string | null {
  const stderr = stderrChunks.join("").trim();
  if (!stderr) {
    return null;
  }

  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const actionableLines = lines.filter((line) =>
    line.includes("GH_COPILOT_TOKEN")
    || line.includes("GITHUB_COPILOT_TOKEN")
    || line.includes("minimum required version")
    || line.includes("npm install -g @github/copilot")
    || line.includes("qodercli /login")
    || line.includes("qodercli login")
    || line.includes("could not open a new TTY")
    || line.includes("device not configured")
  );
  if (actionableLines.length === 0) {
    return null;
  }

  return actionableLines.slice(-4).join("\n").replace(/qodercli \/login/g, "qodercli login");
}

function terminateRuntimeProcess(
  child: ReturnType<typeof spawn>,
  logger?: RuntimeDebugLogger,
): void {
  if (child.killed) {
    return;
  }

  const pid = child.pid;
  try {
    if (pid && process.platform !== "win32") {
      process.kill(-pid, "SIGTERM");
      logger?.log("runtime", "runtime process group terminated", {
        pid,
        signal: "SIGTERM",
      });
      return;
    }
  } catch (error) {
    logger?.log("runtime", "runtime process group termination failed", error);
  }

  child.kill();
}

async function createNewSession(
  connection: acp.ClientSideConnection,
  authMethods: AcpAuthMethod[] | undefined,
  input: RuntimeSessionCreateInput,
): Promise<AcpSessionResponse> {
  input.logger?.log("runtime", "runtime new session started", {
    cwd: input.cwd,
  });
  const session = await runWithAuthentication(
    () => connection.newSession(buildSessionRequest(input)),
    connection,
    authMethods,
    input,
    "new session",
  );
  input.logger?.log("runtime", "runtime new session completed", {
    sessionId: session.sessionId,
    modelCount: normalizeModelState(session.models)?.availableModels.length ?? 0,
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
  authMethods: AcpAuthMethod[] | undefined,
  input: RuntimeSessionCreateInput,
): Promise<AcpSessionResponse> {
  const sessionId = input.resumeSessionId!;
  const supportsResume = Boolean(capabilities?.sessionCapabilities?.resume);
  const supportsLoad = Boolean(capabilities?.loadSession);

  if (supportsResume) {
    input.logger?.log("runtime", "runtime session resume started", {
      sessionId,
      cwd: input.cwd,
    });
    const resumed = await runWithAuthentication(
      () => connection.unstable_resumeSession({
        ...buildSessionRequest(input),
        sessionId,
      }),
      connection,
      authMethods,
      input,
      "session resume",
    );
    input.logger?.log("runtime", "runtime session resume completed", {
      sessionId: resumed.sessionId,
      modelCount: normalizeModelState(resumed.models)?.availableModels.length ?? 0,
    });

    return resumed;
  }

  if (supportsLoad) {
    input.logger?.log("runtime", "runtime session load started", {
      sessionId,
      cwd: input.cwd,
    });
    const loaded = await runWithAuthentication(
      () => connection.loadSession({
        ...buildSessionRequest(input),
        sessionId,
      }),
      connection,
      authMethods,
      input,
      "session load",
    );
    input.logger?.log("runtime", "runtime session load completed", {
      sessionId: loaded.sessionId,
      modelCount: normalizeModelState(loaded.models)?.availableModels.length ?? 0,
    });

    return loaded;
  }

  throw new Error(`Agent does not support resuming session ${sessionId}`);
}

type NewSessionRequest = Parameters<acp.ClientSideConnection["newSession"]>[0];
type AcpAuthMethod = NonNullable<Awaited<ReturnType<acp.ClientSideConnection["initialize"]>>["authMethods"]>[number];
type AcpSessionResponse = {
  sessionId: string;
  models?: unknown;
};

async function runWithAuthentication<T extends AcpSessionResponse>(
  operation: () => Promise<T>,
  connection: acp.ClientSideConnection,
  authMethods: AcpAuthMethod[] | undefined,
  input: RuntimeSessionCreateInput,
  label: string,
): Promise<T> {
  if (input.authenticationMethodId && input.allowAuthentication !== false) {
    try {
      const initializedSession = await operation();
      if (input.authenticationHandledByLaunch) {
        input.logger?.log("runtime", "runtime authentication handled by launch configuration", {
          label,
          methodId: input.authenticationMethodId,
          sessionId: initializedSession.sessionId,
        });
        return initializedSession;
      }

      if (sessionHasAvailableModels(initializedSession)) {
        return initializedSession;
      }

      input.logger?.log("runtime", "runtime authentication deferred until after session initialization", {
        label,
        methodId: input.authenticationMethodId,
        sessionId: initializedSession.sessionId,
      });
      await authenticateWithSelectedMethod(connection, authMethods, input, label, input.authenticationMethodId);
      return operation();
    } catch (error) {
      if (!isAuthenticationRequired(error)) {
        throw error;
      }

      await authenticateWithSelectedMethod(connection, authMethods, input, label, input.authenticationMethodId);
      return operation();
    }
  }

  try {
    return await operation();
  } catch (error) {
    if (!isAuthenticationRequired(error)) {
      throw error;
    }

    const method = authMethods?.[0];
    if (!method) {
      throw error;
    }

    if (input.allowAuthentication === false) {
      input.logger?.log("runtime", "runtime authentication skipped", {
        label,
      });
      throw new RuntimeAuthenticationRequiredError(normalizeAuthMethods(authMethods), error);
    }

    await authenticateWithSelectedMethod(connection, authMethods, input, label, method.id);
    return operation();
  }
}

function sessionHasAvailableModels(session: AcpSessionResponse): boolean {
  return (normalizeModelState(session.models)?.availableModels.length ?? 0) > 0;
}

async function authenticateWithSelectedMethod(
  connection: acp.ClientSideConnection,
  authMethods: AcpAuthMethod[] | undefined,
  input: RuntimeSessionCreateInput,
  label: string,
  methodId: string,
): Promise<void> {
  const selectedMethod = authMethods?.find((entry) => entry.id === methodId);
  if (!selectedMethod) {
    throw new Error(`Authentication method ${methodId} is not available`);
  }

  input.logger?.log("runtime", "runtime authentication requested", {
    label,
    methodId: selectedMethod.id,
    methodName: "name" in selectedMethod ? selectedMethod.name : undefined,
  });
  await connection.authenticate({
    methodId: selectedMethod.id,
  });
  input.logger?.log("runtime", "runtime authentication completed", {
    label,
    methodId: selectedMethod.id,
  });
}

function isAuthenticationRequired(error: unknown): boolean {
  if (error instanceof acp.RequestError && error.code === -32000) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };
  return candidate.code === -32000 || candidate.message === "Authentication required";
}

function withStartupTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new Error(`Runtime startup timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function normalizeModelState(value: unknown): ModelState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    currentModelId?: unknown;
    availableModels?: unknown;
  };
  if (typeof candidate.currentModelId !== "string" || !Array.isArray(candidate.availableModels)) {
    return null;
  }

  const availableModels = candidate.availableModels
    .map((model): ModelState["availableModels"][number] | null => {
      if (!model || typeof model !== "object") {
        return null;
      }
      const entry = model as {
        modelId?: unknown;
        name?: unknown;
        description?: unknown;
      };
      if (typeof entry.modelId !== "string" || typeof entry.name !== "string") {
        return null;
      }
      return {
        modelId: entry.modelId,
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description : null,
      };
    })
    .filter((model): model is ModelState["availableModels"][number] => model !== null);

  return {
    currentModelId: candidate.currentModelId,
    availableModels,
  };
}

function normalizeAuthMethods(authMethods: AcpAuthMethod[] | undefined): AuthMethodSummary[] {
  return (authMethods ?? []).map((method) => {
    const explicitType = "type" in method && (method.type === "env_var" || method.type === "terminal")
      ? method.type
      : null;
    const envVars = Array.isArray((method as { vars?: unknown }).vars)
      ? normalizeAuthEnvVars((method as { vars?: unknown[] }).vars)
      : [];
    const description = "description" in method && typeof method.description === "string"
      ? method.description
      : null;
    const inferredEnvVars = explicitType ? [] : inferAuthEnvVarsFromMethod(method);
    const type = explicitType ?? (envVars.length > 0 || inferredEnvVars.length > 0 ? "env_var" : "agent");
    const summary: AuthMethodSummary = {
      id: method.id,
      type,
      name: "name" in method && typeof method.name === "string" ? method.name : null,
      description,
    };

    if (type === "env_var") {
      summary.vars = envVars.length > 0 ? envVars : inferredEnvVars;
      summary.link = "link" in method && typeof method.link === "string" ? method.link : null;
    }

    if (type === "terminal") {
      if ("args" in method && Array.isArray(method.args)) {
        summary.args = (method.args as unknown[]).filter((arg): arg is string => typeof arg === "string");
      }
      if ("env" in method && method.env && typeof method.env === "object") {
        summary.env = Object.fromEntries(
          Object.entries(method.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
      }
    }

    return summary;
  });
}

function inferAuthEnvVarsFromMethod(method: AcpAuthMethod): AuthEnvVarSummary[] {
  const text = [
    method.id,
    "name" in method && typeof method.name === "string" ? method.name : null,
    "description" in method && typeof method.description === "string" ? method.description : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
  const names = new Set<string>();
  const envVarPattern = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

  for (const match of text.matchAll(envVarPattern)) {
    names.add(match[0]);
  }

  return Array.from(names).map((name) => ({
    name,
    label: null,
    optional: false,
    secret: true,
  }));
}

function normalizeAuthEnvVars(vars: unknown[] | undefined): AuthEnvVarSummary[] {
  return (vars ?? [])
    .map((variable): AuthEnvVarSummary | null => {
      const candidate = variable as {
        name?: unknown;
        label?: unknown;
        optional?: unknown;
        secret?: unknown;
      };
      if (!candidate || typeof candidate !== "object" || typeof candidate.name !== "string") {
        return null;
      }
      return {
        name: candidate.name,
        label: typeof candidate.label === "string" ? candidate.label : null,
        optional: candidate.optional === true,
        secret: candidate.secret !== false,
      };
    })
    .filter((variable): variable is AuthEnvVarSummary => variable !== null);
}

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
