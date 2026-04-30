import type {
  AgentAuthStatus,
  ConversationSummary,
  ModelState,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
import { LRUCache } from "lru-cache";
import { RuntimeAuthenticationRequiredError } from "./runtime.js";
import type {
  RuntimeDebugLogger,
  RuntimeHost,
  RuntimeSessionCreateInput,
  RuntimeSessionLike,
} from "./runtime.js";

export interface CreateSessionInput {
  agent: ResolvedAgent;
  context: PromptEnvelope["context"];
}

export interface SessionStoreRepository {
  saveSummary(summary: ConversationSummary): Promise<void>;
  deleteSummary(sessionId: string): Promise<void>;
  readSummary(sessionId: string): Promise<ConversationSummary | null>;
  listSummaries(): Promise<ConversationSummary[]>;
  appendEvent(sessionId: string, event: SessionEvent): Promise<void>;
  readTranscript(sessionId: string): Promise<SessionEvent[]>;
}

export interface SessionManagerOptions {
  store: SessionStoreRepository;
  defaultCwd: string;
  logger?: RuntimeDebugLogger;
  resolveAgent?: (agentId: string) => Promise<ResolvedAgent | null>;
  createRuntime?: (input: RuntimeSessionCreateInput) => Promise<RuntimeSessionLike>;
  runtimeHost?: RuntimeHost;
  maxActiveRuntimes?: number;
  modelProbeTimeoutMs?: number;
  agentAuthenticationTimeoutMs?: number;
  createTurnId?: () => string;
}

type Subscriber = (event: SessionEvent) => void;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_PROBE_TIMEOUT_MS = 30 * 1000;
const AGENT_AUTHENTICATION_TIMEOUT_MS = 10 * 60 * 1000;
const EMPTY_MODEL_AUTH_ERROR = "API key 登录没有返回可用模型，请检查凭证后重试。";

function sanitizeCredentialEnv(env: Record<string, string> | undefined): Record<string, string> | null {
  if (!env) {
    return null;
  }

  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);

  if (entries.length === 0) {
    return null;
  }

  return Object.fromEntries(entries);
}

function hasAvailableModels(models: ModelState | null | undefined): models is ModelState {
  return Boolean(models?.availableModels.length);
}

export class SessionManager {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly runtimes = new Map<string, RuntimeSessionLike>();
  private readonly runtimeLastUsedAt = new Map<string, number>();
  private readonly summaries = new Map<string, ConversationSummary>();
  private readonly eventChains = new Map<string, Promise<void>>();
  private readonly modelCache = new LRUCache<string, ModelState>({
    max: 200,
    ttl: MODEL_CACHE_TTL_MS,
  });
  private readonly agentModelCache = new LRUCache<string, ModelState>({
    max: 100,
    ttl: MODEL_CACHE_TTL_MS,
  });
  private readonly agentAuthCache = new LRUCache<string, AgentAuthStatus>({
    max: 100,
    ttl: 60 * 1000,
  });
  private readonly agentCredentialEnvCache = new LRUCache<string, Record<string, string>>({
    max: 100,
    ttl: MODEL_CACHE_TTL_MS,
  });
  private readonly agentModelProbePromises = new Map<string, Promise<ModelState | null>>();

  constructor(
    private readonly options: SessionManagerOptions,
  ) {}

  async createSession(input: CreateSessionInput): Promise<ConversationSummary> {
    this.options.logger?.log("session", "create session requested", {
      agentId: input.agent.id,
      agentName: input.agent.name,
      launchCommand: input.agent.launchCommand,
      launchArgs: input.agent.launchArgs,
    });
    await this.evictRuntimeIfNeeded();
    const runtime = await this.createRuntime(input.agent, undefined, undefined, {
      env: this.getAgentCredentialEnv(input.agent.id),
    });

    const now = input.context.capturedAt;
    const summary: ConversationSummary = {
      id: runtime.sessionId,
      agentId: input.agent.id,
      agentName: input.agent.name,
      title: `Reading: ${input.context.title}`,
      pageTitle: input.context.title,
      pageUrl: input.context.url,
      createdAt: now,
      lastActivityAt: now,
      active: true,
      readOnly: false,
    };

    this.attachRuntime(summary.id, runtime);
    this.cacheModels(summary.id, runtime.getModelState());
    this.summaries.set(summary.id, summary);
    await this.options.store.saveSummary(summary);
    this.options.logger?.log("session", "session created", {
      sessionId: summary.id,
      agentId: summary.agentId,
      pageTitle: summary.pageTitle,
    });
    await this.recordEvent({
      type: "session.started",
      sessionId: summary.id,
      summary,
    });

    return summary;
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const listeners = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    listeners.add(subscriber);
    this.subscribers.set(sessionId, listeners);

    return () => {
      listeners.delete(subscriber);
      if (listeners.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  async sendPrompt(prompt: PromptEnvelope): Promise<{ turnId: string; stopReason: string }> {
    const summary = await this.getSummary(prompt.sessionId);
    if (!summary) {
      throw new Error(`Session ${prompt.sessionId} was not found`);
    }

    const runtime = await this.ensureRuntime(summary, prompt.agentId);
    this.touchRuntime(prompt.sessionId);

    const turnId = this.options.createTurnId?.() ?? crypto.randomUUID();
    this.options.logger?.log("session", "prompt request started", {
      sessionId: prompt.sessionId,
      turnId,
      agentId: prompt.agentId,
      textLength: prompt.text.length,
      pageTitle: prompt.context.title,
    });
    await this.recordEvent({
      type: "context.attached",
      sessionId: prompt.sessionId,
      turnId,
      context: prompt.context,
    });
    await this.recordEvent({
      type: "turn.started",
      sessionId: prompt.sessionId,
      turnId,
      prompt: prompt.text,
      startedAt: new Date().toISOString(),
    });

    try {
      const result = await runtime.prompt(prompt, turnId);
      this.options.logger?.log("session", "prompt request completed", {
        sessionId: prompt.sessionId,
        turnId,
        stopReason: result.stopReason,
      });
      await this.recordEvent({
        type: "turn.completed",
        sessionId: prompt.sessionId,
        turnId,
        stopReason: result.stopReason,
        completedAt: new Date().toISOString(),
      });

      const currentSummary = await this.getSummary(prompt.sessionId);
      if (currentSummary) {
        const updatedSummary: ConversationSummary = {
          ...currentSummary,
          title: prompt.text,
          lastActivityAt: new Date().toISOString(),
          active: true,
          readOnly: false,
        };

        this.summaries.set(prompt.sessionId, updatedSummary);
        await this.options.store.saveSummary(updatedSummary);
      }

      return {
        turnId,
        stopReason: result.stopReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger?.log("session", "prompt request failed", {
        sessionId: prompt.sessionId,
        turnId,
        error: message,
      });
      await this.recordEvent({
        type: "turn.failed",
        sessionId: prompt.sessionId,
        turnId,
        error: message,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async readTranscript(sessionId: string): Promise<SessionEvent[]> {
    return this.options.store.readTranscript(sessionId);
  }

  async listSessions(): Promise<ConversationSummary[]> {
    const stored = await this.options.store.listSummaries();
    return stored.map((entry) => {
      const cached = this.summaries.get(entry.id) ?? entry;
      const merged: ConversationSummary = {
        ...entry,
        ...cached,
        active: this.runtimes.has(entry.id),
      };
      this.summaries.set(merged.id, merged);
      return merged;
    });
  }

  async renameSession(sessionId: string, title: string): Promise<ConversationSummary> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new Error("Session title cannot be empty");
    }

    const summary = await this.getSummary(sessionId);
    if (!summary) {
      throw new Error(`Session ${sessionId} was not found`);
    }

    const updatedSummary: ConversationSummary = {
      ...summary,
      title: nextTitle,
    };
    this.summaries.set(sessionId, updatedSummary);
    await this.options.store.saveSummary(updatedSummary);
    return updatedSummary;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) {
      this.runtimes.delete(sessionId);
      this.runtimeLastUsedAt.delete(sessionId);
      await runtime.dispose();
    }

    this.subscribers.delete(sessionId);
    this.eventChains.delete(sessionId);
    this.modelCache.delete(sessionId);
    this.summaries.delete(sessionId);
    await this.options.store.deleteSummary(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return;
    }

    await runtime.cancel();
  }

  async resolvePermission(sessionId: string, decision: PermissionDecision): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new Error(`Session ${sessionId} has no active runtime for permission approval`);
    }

    this.touchRuntime(sessionId);
    await runtime.resolvePermission(decision);
  }

  async getModels(sessionId: string): Promise<ModelState | null> {
    const cached = this.modelCache.get(sessionId);
    if (cached) {
      return cached;
    }

    const summary = await this.getSummary(sessionId);
    if (!summary) {
      throw new Error(`Session ${sessionId} was not found`);
    }

    const activeRuntime = this.runtimes.get(sessionId);
    if (activeRuntime) {
      const models = activeRuntime.getModelState();
      this.cacheModels(sessionId, models);
      this.touchRuntime(sessionId);
      return models;
    }

    try {
      const runtime = await this.ensureRuntime(summary, summary.agentId);
      const models = runtime.getModelState();
      this.cacheModels(sessionId, models);
      return models;
    } catch (error) {
      const agent = await this.options.resolveAgent?.(summary.agentId);
      if (!agent) {
        throw error;
      }

      this.options.logger?.log("session", "session model restore failed; probing agent models", {
        sessionId,
        agentId: summary.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getAgentModels(agent);
    }
  }

  async getAgentModels(agent: ResolvedAgent): Promise<ModelState | null> {
    const cached = this.agentModelCache.get(agent.id);
    if (cached) {
      return cached;
    }

    const pendingProbe = this.agentModelProbePromises.get(agent.id);
    if (pendingProbe) {
      this.options.logger?.log("session", "agent model probe joined", {
        agentId: agent.id,
        agentName: agent.name,
      });
      return pendingProbe;
    }

    this.options.logger?.log("session", "agent model probe requested", {
      agentId: agent.id,
      agentName: agent.name,
      launchCommand: agent.launchCommand,
      launchArgs: agent.launchArgs,
    });

    const probe = this.probeAgentModels(agent);
    this.agentModelProbePromises.set(agent.id, probe);
    try {
      return await probe;
    } finally {
      if (this.agentModelProbePromises.get(agent.id) === probe) {
        this.agentModelProbePromises.delete(agent.id);
      }
    }
  }

  async getAgentAuthStatus(agent: ResolvedAgent): Promise<AgentAuthStatus> {
    const cached = this.agentAuthCache.get(agent.id);
    if (cached) {
      return cached;
    }

    this.options.logger?.log("session", "agent auth status requested", {
      agentId: agent.id,
      agentName: agent.name,
    });

    try {
      const timeoutMs = this.options.modelProbeTimeoutMs ?? MODEL_PROBE_TIMEOUT_MS;
      const runtime = await this.withRuntimeStartupTimeout(
        this.createRuntime(agent, undefined, async () => undefined, {
          allowAuthentication: false,
          startupTimeoutMs: timeoutMs,
          env: this.getAgentCredentialEnv(agent.id),
        }),
        timeoutMs,
        "Model probe",
      );
      const models = runtime.getModelState();
      const methods = runtime.getAuthMethods?.() ?? [];
      if (!hasAvailableModels(models)) {
        this.cacheAgentModels(agent.id, null);
        const status = this.cacheAgentAuthStatus(agent.id, {
          state: methods.length > 0 ? "unauthenticated" : "unavailable",
          methods,
          checkedAt: new Date().toISOString(),
          error: "当前 Agent 没有返回可切换的模型列表。",
          models,
        });
        void this.disposeProbeRuntime(agent, runtime);
        return status;
      }

      this.cacheAgentModels(agent.id, models);
      const status = this.cacheAgentAuthStatus(agent.id, {
        state: methods.length > 0 ? "authenticated" : "not_required",
        methods,
        checkedAt: new Date().toISOString(),
        models,
      });
      void this.disposeProbeRuntime(agent, runtime);
      return status;
    } catch (error) {
      const status = this.authStatusFromError(agent.id, error);
      if (status) {
        return status;
      }

      const unavailable = this.cacheAgentAuthStatus(agent.id, {
        state: "unavailable",
        methods: [],
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return unavailable;
    }
  }

  async authenticateAgent(
    agent: ResolvedAgent,
    methodId?: string,
    env?: Record<string, string>,
  ): Promise<AgentAuthStatus> {
    this.options.logger?.log("session", "agent authentication requested", {
      agentId: agent.id,
      agentName: agent.name,
      methodId,
    });

    try {
      const credentialEnv = sanitizeCredentialEnv(env);
      this.options.logger?.log("session", "agent authentication credential env prepared", {
        agentId: agent.id,
        methodId,
        envKeys: credentialEnv ? Object.keys(credentialEnv) : [],
      });
      const timeoutMs = this.options.agentAuthenticationTimeoutMs ?? AGENT_AUTHENTICATION_TIMEOUT_MS;
      const runtime = await this.withRuntimeStartupTimeout(
        this.createRuntime(agent, undefined, async () => undefined, {
          allowAuthentication: credentialEnv ? false : true,
          authenticationMethodId: methodId,
          startupTimeoutMs: timeoutMs,
          env: credentialEnv ?? this.getAgentCredentialEnv(agent.id),
        }),
        timeoutMs,
        "Agent authentication",
      );
      const models = runtime.getModelState();
      const methods = runtime.getAuthMethods?.() ?? [];
      if (credentialEnv && !hasAvailableModels(models)) {
        this.agentCredentialEnvCache.delete(agent.id);
        this.cacheAgentModels(agent.id, null);
        const status = this.cacheAgentAuthStatus(agent.id, {
          state: "unauthenticated",
          methods,
          checkedAt: new Date().toISOString(),
          error: EMPTY_MODEL_AUTH_ERROR,
          models,
        });
        void this.disposeProbeRuntime(agent, runtime);
        return status;
      }

      if (credentialEnv) {
        this.agentCredentialEnvCache.set(agent.id, credentialEnv);
      }
      this.cacheAgentModels(agent.id, models);
      const status = this.cacheAgentAuthStatus(agent.id, {
        state: "authenticated",
        methods,
        checkedAt: new Date().toISOString(),
        models,
      });
      void this.disposeProbeRuntime(agent, runtime);
      return status;
    } catch (error) {
      const status = this.authStatusFromError(agent.id, error);
      if (status) {
        return status;
      }

      return this.cacheAgentAuthStatus(agent.id, {
        state: "unavailable",
        methods: [],
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async setModel(sessionId: string, modelId: string): Promise<ModelState | null> {
    const summary = await this.getSummary(sessionId);
    if (!summary) {
      throw new Error(`Session ${sessionId} was not found`);
    }

    const runtime = await this.ensureRuntime(summary, summary.agentId);
    this.touchRuntime(sessionId);
    const models = await runtime.setModel(modelId);
    this.cacheModels(sessionId, models);
    const updatedSummary: ConversationSummary = {
      ...summary,
      active: true,
      readOnly: false,
      lastActivityAt: new Date().toISOString(),
    };
    this.summaries.set(sessionId, updatedSummary);
    await this.options.store.saveSummary(updatedSummary);

    return models;
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.runtimes.entries()].map(async ([sessionId, runtime]) => {
        await runtime.dispose();
        await this.updateSummary(sessionId, {
          active: false,
        });
      }),
    );
    this.runtimes.clear();
    this.runtimeLastUsedAt.clear();
  }

  private recordEvent(event: SessionEvent): Promise<void> {
    const previous = this.eventChains.get(event.sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.options.store.appendEvent(event.sessionId, event);
        const listeners = this.subscribers.get(event.sessionId);
        listeners?.forEach((subscriber) => subscriber(event));
      });

    this.eventChains.set(event.sessionId, next);

    return next.finally(() => {
      if (this.eventChains.get(event.sessionId) === next) {
        this.eventChains.delete(event.sessionId);
      }
    });
  }

  private async ensureRuntime(summary: ConversationSummary, agentId: string): Promise<RuntimeSessionLike> {
    const existing = this.runtimes.get(summary.id);
    if (existing) {
      return existing;
    }

    const resolvedAgent = await this.options.resolveAgent?.(summary.agentId || agentId);
    if (!resolvedAgent) {
      this.options.logger?.log("session", "prompt rejected because no resumable agent could be resolved", {
        sessionId: summary.id,
        agentId: summary.agentId || agentId,
      });
      throw new Error(`Session ${summary.id} is not active`);
    }

    this.options.logger?.log("session", "session restore requested", {
      sessionId: summary.id,
      agentId: resolvedAgent.id,
      launchCommand: resolvedAgent.launchCommand,
      launchArgs: resolvedAgent.launchArgs,
    });
    await this.evictRuntimeIfNeeded(summary.id);

    try {
      const runtime = await this.createRuntime(resolvedAgent, summary.id);
      this.attachRuntime(summary.id, runtime);
      this.cacheModels(summary.id, runtime.getModelState());
      await this.updateSummary(summary.id, {
        active: true,
        readOnly: false,
      }, summary);
      return runtime;
    } catch (error) {
      await this.updateSummary(summary.id, {
        active: false,
      }, summary);
      throw error;
    }
  }

  private async createRuntime(
    agent: ResolvedAgent,
    resumeSessionId?: string,
    onEvent: RuntimeSessionCreateInput["onEvent"] = async (event) => {
      await this.recordEvent(event);
    },
    overrides: Pick<RuntimeSessionCreateInput, "allowAuthentication" | "authenticationMethodId" | "authenticationHandledByLaunch" | "startupTimeoutMs" | "env"> = {},
  ): Promise<RuntimeSessionLike> {
    const runtimeInput: RuntimeSessionCreateInput = {
      cwd: this.options.defaultCwd,
      command: agent.launchCommand,
      args: agent.launchArgs,
      resumeSessionId,
      onEvent,
      logger: this.options.logger,
      ...overrides,
    };

    if (this.options.createRuntime) {
      return this.options.createRuntime(runtimeInput);
    }

    const runtimeHost = this.options.runtimeHost;
    if (!runtimeHost) {
      throw new Error("SessionManager requires createRuntime or runtimeHost to create runtime sessions");
    }

    return runtimeHost.create({
      agent,
      cwd: this.options.defaultCwd,
      resumeSessionId,
      runtime: {
        onEvent: runtimeInput.onEvent,
        logger: runtimeInput.logger,
        env: runtimeInput.env,
        allowAuthentication: runtimeInput.allowAuthentication,
        authenticationMethodId: runtimeInput.authenticationMethodId,
        authenticationHandledByLaunch: runtimeInput.authenticationHandledByLaunch,
        startupTimeoutMs: runtimeInput.startupTimeoutMs,
      },
    });
  }

  private withRuntimeStartupTimeout(
    runtimePromise: Promise<RuntimeSessionLike>,
    timeoutMs: number,
    label: string,
  ): Promise<RuntimeSessionLike> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      runtimePromise.then(
        (runtime) => {
          clearTimeout(timeout);
          resolve(runtime);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  private attachRuntime(sessionId: string, runtime: RuntimeSessionLike): void {
    this.runtimes.set(sessionId, runtime);
    this.touchRuntime(sessionId);
  }

  private touchRuntime(sessionId: string): void {
    this.runtimeLastUsedAt.set(sessionId, Date.now());
  }

  private cacheModels(sessionId: string, models: ModelState | null): void {
    if (!hasAvailableModels(models)) {
      this.modelCache.delete(sessionId);
      return;
    }

    this.modelCache.set(sessionId, models);
  }

  private cacheAgentModels(agentId: string, models: ModelState | null): void {
    if (!hasAvailableModels(models)) {
      this.agentModelCache.delete(agentId);
      return;
    }

    this.agentModelCache.set(agentId, models);
  }

  private cacheAgentAuthStatus(agentId: string, status: AgentAuthStatus): AgentAuthStatus {
    this.agentAuthCache.set(agentId, status);
    return status;
  }

  private getAgentCredentialEnv(agentId: string): Record<string, string> | undefined {
    const env = this.agentCredentialEnvCache.get(agentId);
    if (!env) {
      return undefined;
    }
    return { ...env };
  }

  private authStatusFromError(agentId: string, error: unknown): AgentAuthStatus | null {
    if (!(error instanceof RuntimeAuthenticationRequiredError)) {
      return null;
    }

    return this.cacheAgentAuthStatus(agentId, {
      state: "unauthenticated",
      methods: error.authMethods,
      checkedAt: new Date().toISOString(),
      error: error.message,
    });
  }

  private async probeAgentModels(agent: ResolvedAgent): Promise<ModelState | null> {
    const timeoutMs = this.options.modelProbeTimeoutMs ?? MODEL_PROBE_TIMEOUT_MS;
    const runtime = await this.withRuntimeStartupTimeout(
      this.createRuntime(agent, undefined, async () => undefined, {
        allowAuthentication: false,
        startupTimeoutMs: timeoutMs,
        env: this.getAgentCredentialEnv(agent.id),
      }),
      timeoutMs,
      "Model probe",
    );
    try {
      const models = runtime.getModelState();
      this.cacheAgentModels(agent.id, models);
      return models;
    } finally {
      void this.disposeProbeRuntime(agent, runtime);
    }
  }

  private async disposeProbeRuntime(agent: ResolvedAgent, runtime: RuntimeSessionLike): Promise<void> {
    try {
      await runtime.dispose();
    } catch (error) {
      this.options.logger?.log("session", "agent model probe runtime dispose failed", {
        agentId: agent.id,
        agentName: agent.name,
        sessionId: runtime.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async evictRuntimeIfNeeded(exemptSessionId?: string): Promise<void> {
    const maxActiveRuntimes = this.options.maxActiveRuntimes ?? Number.POSITIVE_INFINITY;

    while (this.runtimes.size >= maxActiveRuntimes) {
      const nextEviction = [...this.runtimeLastUsedAt.entries()]
        .filter(([sessionId]) => sessionId !== exemptSessionId && this.runtimes.has(sessionId))
        .sort((left, right) => left[1] - right[1])[0];

      if (!nextEviction) {
        return;
      }

      await this.deactivateRuntime(nextEviction[0], "runtime limit reached");
    }
  }

  private async deactivateRuntime(sessionId: string, reason: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return;
    }

    this.options.logger?.log("session", "runtime evicted", {
      sessionId,
      reason,
    });
    this.runtimes.delete(sessionId);
    this.runtimeLastUsedAt.delete(sessionId);
    await runtime.dispose();
    await this.updateSummary(sessionId, {
      active: false,
    });
  }

  private async getSummary(sessionId: string): Promise<ConversationSummary | null> {
    const cached = this.summaries.get(sessionId);
    if (cached) {
      return cached;
    }

    const stored = await this.options.store.readSummary(sessionId);
    if (stored) {
      this.summaries.set(sessionId, stored);
    }
    return stored;
  }

  private async updateSummary(
    sessionId: string,
    partial: Partial<ConversationSummary>,
    baseSummary?: ConversationSummary,
  ): Promise<void> {
    const current = baseSummary ?? await this.getSummary(sessionId);
    if (!current) {
      return;
    }

    const next: ConversationSummary = {
      ...current,
      ...partial,
    };
    this.summaries.set(sessionId, next);
    await this.options.store.saveSummary(next);
  }
}
