import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContextBundle, PromptEnvelope, ResolvedAgent } from "@browser-acp/shared-types";
import { createSessionService } from "../src/application/sessionService.js";
import { SessionManager } from "../src/session/sessionManager.js";
import { SessionStore } from "../src/store/sessionStore.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("SessionManager runtime lifecycle", () => {
  it("delegates session queries through the application service", async () => {
    const listSessions = vi.fn().mockResolvedValue([{ id: "session-1" }]);
    const manager = {
      listSessions,
      createSession: vi.fn(),
      readTranscript: vi.fn(),
      sendPrompt: vi.fn(),
      subscribe: vi.fn(),
      cancel: vi.fn(),
    } as unknown as SessionManager;

    const service = createSessionService({ manager });
    const result = await service.list();

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: "session-1" }]);
  });

  it("evicts the least recently used runtime and resumes an existing session on demand", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const context: BrowserContextBundle = {
      tabId: 1,
      url: "https://example.com/post",
      title: "Example post",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-08T04:00:00.000Z",
    };
    const agent: ResolvedAgent = {
      id: "mock-agent",
      name: "Mock Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: "mock-agent",
      },
      status: "ready",
      launchCommand: "mock-agent",
      launchArgs: ["--acp"],
    };

    const runtimeOne = {
      sessionId: "session-1",
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const runtimeTwo = {
      sessionId: "session-2",
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const resumedRuntimeOne = {
      sessionId: "session-1",
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi
      .fn()
      .mockResolvedValueOnce(runtimeOne)
      .mockResolvedValueOnce(runtimeTwo)
      .mockResolvedValueOnce(resumedRuntimeOne);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      maxActiveRuntimes: 1,
      resolveAgent: vi.fn().mockResolvedValue(agent),
      createRuntime,
    });

    const sessionOne = await manager.createSession({ agent, context });
    const sessionTwo = await manager.createSession({
      agent,
      context: {
        ...context,
        capturedAt: "2026-04-08T04:02:00.000Z",
        title: "Second page",
      },
    });

    await manager.sendPrompt({
      sessionId: sessionOne.id,
      agentId: agent.id,
      text: "Resume this session",
      context,
    } satisfies PromptEnvelope);

    const sessions = await manager.listSessions();

    expect(createRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "mock-agent",
        args: ["--acp"],
        resumeSessionId: undefined,
      }),
    );
    expect(createRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resumeSessionId: undefined,
      }),
    );
    expect(createRuntime).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        resumeSessionId: sessionOne.id,
      }),
    );
    expect(runtimeOne.dispose).toHaveBeenCalledTimes(1);
   expect(runtimeTwo.dispose).toHaveBeenCalledTimes(1);
    expect(resumedRuntimeOne.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionOne.id,
        text: "Resume this session",
      }),
      expect.any(String),
    );
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sessionOne.id, active: true }),
        expect.objectContaining({ id: sessionTwo.id, active: false }),
      ]),
    );
  });
});
