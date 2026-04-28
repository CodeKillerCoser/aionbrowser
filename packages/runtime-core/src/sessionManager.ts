import type {
  ConversationSummary,
  ModelState,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
import { LRUCache } from "lru-cache";
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
  createTurnId?: () => string;
}

type Subscriber = (event: SessionEvent) => void;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_PROBE_TIMEOUT_MS = 15 * 1000;

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
    const runtime = await this.createRuntime(input.agent);

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
    overrides: Pick<RuntimeSessionCreateInput, "allowAuthentication" | "startupTimeoutMs"> = {},
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
        allowAuthentication: runtimeInput.allowAuthentication,
        startupTimeoutMs: runtimeInput.startupTimeoutMs,
      },
    });
  }

  private withModelProbeTimeout(
    runtimePromise: Promise<RuntimeSessionLike>,
  ): Promise<RuntimeSessionLike> {
    const timeoutMs = this.options.modelProbeTimeoutMs ?? MODEL_PROBE_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Model probe timed out after ${timeoutMs}ms`));
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
    if (!models) {
      this.modelCache.delete(sessionId);
      return;
    }

    this.modelCache.set(sessionId, models);
  }

  private cacheAgentModels(agentId: string, models: ModelState | null): void {
    if (!models) {
      this.agentModelCache.delete(agentId);
      return;
    }

    this.agentModelCache.set(agentId, models);
  }

  private async probeAgentModels(agent: ResolvedAgent): Promise<ModelState | null> {
    const runtime = await this.withModelProbeTimeout(
      this.createRuntime(agent, undefined, async () => undefined, {
        allowAuthentication: false,
        startupTimeoutMs: this.options.modelProbeTimeoutMs ?? MODEL_PROBE_TIMEOUT_MS,
      }),
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
