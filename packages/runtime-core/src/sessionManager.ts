import type {
  ConversationSummary,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
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
  createTurnId?: () => string;
}

type Subscriber = (event: SessionEvent) => void;

export class SessionManager {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly runtimes = new Map<string, RuntimeSessionLike>();
  private readonly runtimeLastUsedAt = new Map<string, number>();
  private readonly summaries = new Map<string, ConversationSummary>();
  private readonly eventChains = new Map<string, Promise<void>>();

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

  private async createRuntime(agent: ResolvedAgent, resumeSessionId?: string): Promise<RuntimeSessionLike> {
    const runtimeInput: RuntimeSessionCreateInput = {
      cwd: this.options.defaultCwd,
      command: agent.launchCommand,
      args: agent.launchArgs,
      resumeSessionId,
      onEvent: async (event) => {
        await this.recordEvent(event);
      },
      logger: this.options.logger,
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
      },
    });
  }

  private attachRuntime(sessionId: string, runtime: RuntimeSessionLike): void {
    this.runtimes.set(sessionId, runtime);
    this.touchRuntime(sessionId);
  }

  private touchRuntime(sessionId: string): void {
    this.runtimeLastUsedAt.set(sessionId, Date.now());
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
