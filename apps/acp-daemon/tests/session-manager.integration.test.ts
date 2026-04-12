import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContextBundle, ConversationSummary, PromptEnvelope, ResolvedAgent, SessionEvent } from "@browser-acp/shared-types";
import { createDebugLogger } from "../src/debug/logger.js";
import { buildPromptText } from "../src/session/prompt.js";
import { SessionManager } from "../src/session/sessionManager.js";
import { SessionStore } from "../src/store/sessionStore.js";
import type { RuntimeSessionCreateInput } from "../src/session/runtimeSession.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("SessionManager ACP integration", () => {
  it("spawns an ACP agent, streams prompt output, and persists transcript history", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
    });

    const context: BrowserContextBundle = {
      tabId: 7,
      url: "https://example.com/article",
      title: "Example article",
      selectionText: "Important quoted paragraph.",
      summaryMarkdown: "A short summary of the article.",
      openTabsPreview: [
        {
          tabId: 7,
          title: "Example article",
          url: "https://example.com/article",
          active: true,
        }
      ],
      capturedAt: "2026-04-07T07:00:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "mock-agent",
      name: "Mock Agent",
      description: "Fixture ACP agent",
      website: "https://example.com",
      repository: "https://example.com/repo",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-acp-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-acp-agent.mjs")],
    };

    const summary = await manager.createSession({
      agent,
      context,
    });

    const streamedEvents: string[] = [];
    const unsubscribe = manager.subscribe(summary.id, (event) => {
      streamedEvents.push(event.type);
    });

    const prompt: PromptEnvelope = {
      sessionId: summary.id,
      agentId: agent.id,
      text: "Explain the highlighted paragraph.",
      context,
    };

    const result = await manager.sendPrompt(prompt);
    unsubscribe();
    await manager.dispose();

    const transcript = await store.readTranscript(summary.id);

    expect(result.stopReason).toBe("end_turn");
    expect(streamedEvents).toContain("turn.delta");
    expect(transcript.some((event) => event.type === "context.attached")).toBe(true);
    expect(transcript.some((event) => event.type === "turn.completed")).toBe(true);
    expect(
      transcript.some(
        (event) =>
          event.type === "turn.delta" &&
          event.updateKind === "agent_message_chunk" &&
          event.chunk.includes("Mock agent saw:"),
      ),
    ).toBe(true);
  });

  it("keeps streamed updates on the same turn and preserves thought text", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
    });

    const context: BrowserContextBundle = {
      tabId: 9,
      url: "https://example.com/thoughts",
      title: "Thoughtful article",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-08T06:00:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "thoughtful-agent",
      name: "Thoughtful Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-thoughtful-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-thoughtful-agent.mjs")],
    };

    const summary = await manager.createSession({
      agent,
      context,
    });

    const result = await manager.sendPrompt({
      sessionId: summary.id,
      agentId: agent.id,
      text: "Share the answer",
      context,
    } satisfies PromptEnvelope);

    const transcript = await store.readTranscript(summary.id);
    await manager.dispose();
    const turnDeltas = transcript.filter(
      (event) => event.type === "turn.delta",
    );

    expect(result.stopReason).toBe("end_turn");
    expect(turnDeltas.length).toBeGreaterThan(1);
    expect(turnDeltas.every((event) => event.turnId === result.turnId)).toBe(true);
    expect(
      turnDeltas.some(
        (event) =>
          event.updateKind === "agent_thought_chunk" &&
          event.chunk === "Thinking about the best answer.",
      ),
    ).toBe(true);
    expect(
      turnDeltas.some(
        (event) =>
          event.updateKind === "agent_message_chunk" &&
          event.chunk === "Final answer from the thoughtful agent.",
      ),
    ).toBe(true);
  });

  it("logs the final prompt text sent to the CLI runtime", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const logger = createDebugLogger();
    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      logger,
    });

    const context: BrowserContextBundle = {
      tabId: 5,
      url: "https://example.com/logged",
      title: "Logged article",
      selectionText: "Selected sentence",
      summaryMarkdown: "Long summary ".repeat(80),
      openTabsPreview: [
        {
          tabId: 5,
          title: "Logged article",
          url: "https://example.com/logged",
          active: true,
        },
        {
          tabId: 6,
          title: "Reference tab",
          url: "https://example.com/reference",
          active: false,
        },
      ],
      capturedAt: "2026-04-08T10:00:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "logged-agent",
      name: "Logged Agent",
      description: "Fixture ACP agent",
      website: "https://example.com",
      repository: "https://example.com/repo",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-acp-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-acp-agent.mjs")],
    };

    const summary = await manager.createSession({
      agent,
      context,
    });

    const prompt: PromptEnvelope = {
      sessionId: summary.id,
      agentId: agent.id,
      text: "Show me what was sent",
      context,
    };

    await manager.sendPrompt(prompt);
    await manager.dispose();

    const promptLog = logger.entries().find(
      (entry) => entry.scope === "runtime" && entry.message === "runtime prompt content prepared",
    );

    expect(promptLog?.details).toEqual(
      expect.objectContaining({
        promptText: buildPromptText(prompt),
      }),
    );
  });

  it("waits for a user permission decision before resuming the runtime", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
    });

    const context: BrowserContextBundle = {
      tabId: 11,
      url: "https://example.com/tooling",
      title: "Tooling article",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-10T07:10:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "tool-agent",
      name: "Tool Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-tool-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-tool-agent.mjs")],
    };

    const summary = await manager.createSession({
      agent,
      context,
    });

    const promptPromise = manager.sendPrompt({
      sessionId: summary.id,
      agentId: agent.id,
      text: "Inspect package metadata",
      context,
    });

    const permissionRequest = await waitForTranscriptEvent(
      store,
      summary.id,
      (event): event is Extract<SessionEvent, { type: "permission.requested" }> =>
        event.type === "permission.requested",
    );

    const transcriptBeforeApproval = await store.readTranscript(summary.id);
    expect(
      transcriptBeforeApproval.some((event) => event.type === "permission.resolved"),
    ).toBe(false);

    await manager.resolvePermission(summary.id, {
      permissionId: permissionRequest.permissionId,
      outcome: "selected",
      optionId: "allow-once",
    });

    await promptPromise;

    const transcript = await store.readTranscript(summary.id);
    await manager.dispose();

    expect(
      transcript.some(
        (event) =>
          event.type === "tool.call" &&
          event.toolCall.toolCallId === "tool-call-1" &&
          event.toolCall.title === "Read package.json",
      ),
    ).toBe(true);
    expect(
      transcript.some(
        (event) =>
          event.type === "permission.requested" &&
          event.toolCall.toolCallId === "tool-call-1" &&
          event.options.some((option) => option.kind === "allow_once"),
      ),
    ).toBe(true);
    expect(
      transcript.some(
        (event) =>
          event.type === "permission.resolved" &&
          event.toolCallId === "tool-call-1" &&
          event.outcome === "selected",
      ),
    ).toBe(true);
    expect(
      transcript.some(
        (event) =>
          event.type === "tool.call.update" &&
          event.toolCall.toolCallId === "tool-call-1" &&
          event.toolCall.status === "completed",
      ),
    ).toBe(true);
  });

  it("preserves chunk order when runtime updates arrive concurrently", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new DelayedMemorySessionStore(rootDir);
    const runtimeInputs: RuntimeSessionCreateInput[] = [];
    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      createRuntime: async (input) => {
        runtimeInputs.push(input);

        return {
          sessionId: "concurrent-runtime-session",
          async prompt(prompt, turnId) {
            const firstChunk = input.onEvent({
              type: "turn.delta",
              sessionId: prompt.sessionId,
              turnId,
              chunk: "Hello ",
              role: "agent",
              updateKind: "agent_message_chunk",
            });
            const secondChunk = input.onEvent({
              type: "turn.delta",
              sessionId: prompt.sessionId,
              turnId,
              chunk: "world!",
              role: "agent",
              updateKind: "agent_message_chunk",
            });

            await Promise.all([firstChunk, secondChunk]);

            return {
              stopReason: "end_turn",
            };
          },
          async resolvePermission() {},
          async cancel() {},
          async dispose() {},
        };
      },
    });

    const context: BrowserContextBundle = {
      tabId: 1,
      url: "https://example.com/concurrent",
      title: "Concurrent ordering",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-08T08:00:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "concurrent-agent",
      name: "Concurrent Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-acp-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-acp-agent.mjs")],
    };

    const summary = await manager.createSession({
      agent,
      context,
    });

    expect(runtimeInputs).toHaveLength(1);

    const streamedChunks: string[] = [];
    const unsubscribe = manager.subscribe(summary.id, (event) => {
      if (event.type === "turn.delta" && event.updateKind === "agent_message_chunk") {
        streamedChunks.push(event.chunk);
      }
    });

    await manager.sendPrompt({
      sessionId: summary.id,
      agentId: agent.id,
      text: "Say hello",
      context,
    } satisfies PromptEnvelope);

    unsubscribe();
    const transcript = await store.readTranscript(summary.id);

    const transcriptChunks = transcript
      .filter(
        (event): event is Extract<SessionEvent, { type: "turn.delta" }> =>
          event.type === "turn.delta" && event.updateKind === "agent_message_chunk",
      )
      .map((event) => event.chunk);

    expect(streamedChunks).toEqual(["Hello ", "world!"]);
    expect(transcriptChunks).toEqual(["Hello ", "world!"]);
  });

  it("resumes an existing ACP session after the manager is recreated", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-session-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const context: BrowserContextBundle = {
      tabId: 7,
      url: "https://example.com/article",
      title: "Example article",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-08T04:10:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "resumable-agent",
      name: "Resumable Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-resumable-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-resumable-agent.mjs")],
    };

    const firstManager = new SessionManager({
      store,
      defaultCwd: rootDir,
      resolveAgent: async () => agent,
    });
    const summary = await firstManager.createSession({
      agent,
      context,
    });
    await firstManager.dispose();

    const secondManager = new SessionManager({
      store,
      defaultCwd: rootDir,
      resolveAgent: async () => agent,
    });

    const result = await secondManager.sendPrompt({
      sessionId: summary.id,
      agentId: agent.id,
      text: "Continue the earlier conversation",
      context: {
        ...context,
        capturedAt: "2026-04-08T04:12:00.000Z",
      },
    } satisfies PromptEnvelope);

    const transcript = await store.readTranscript(summary.id);
    await secondManager.dispose();
    const lastDelta = [...transcript].reverse().find((event) => event.type === "turn.delta") as { chunk?: string };

    expect(result.stopReason).toBe("end_turn");
    expect(lastDelta.chunk).toContain(
      `Resumed session ${summary.id}`,
    );
  });
});

class DelayedMemorySessionStore extends SessionStore {
  private readonly summaries = new Map<string, ConversationSummary>();
  private readonly transcripts = new Map<string, SessionEvent[]>();

  override async saveSummary(summary: ConversationSummary): Promise<void> {
    this.summaries.set(summary.id, summary);
  }

  override async listSummaries(): Promise<ConversationSummary[]> {
    return [...this.summaries.values()];
  }

  override async readSummary(sessionId: string): Promise<ConversationSummary | null> {
    return this.summaries.get(sessionId) ?? null;
  }

  override async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    if (
      event.type === "turn.delta" &&
      event.updateKind === "agent_message_chunk" &&
      event.chunk === "Hello "
    ) {
      await delay(20);
    }

    const current = this.transcripts.get(sessionId) ?? [];
    current.push(event);
    this.transcripts.set(sessionId, current);
  }

  override async readTranscript(sessionId: string): Promise<SessionEvent[]> {
    return [...(this.transcripts.get(sessionId) ?? [])];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForTranscriptEvent<TEvent extends SessionEvent>(
  store: SessionStore,
  sessionId: string,
  predicate: (event: SessionEvent) => event is TEvent,
  attempts = 80,
): Promise<TEvent> {
  for (let index = 0; index < attempts; index += 1) {
    const transcript = await store.readTranscript(sessionId);
    const match = transcript.find(predicate);
    if (match) {
      return match;
    }

    await delay(25);
  }

  throw new Error(`Timed out waiting for transcript event in session ${sessionId}`);
}
