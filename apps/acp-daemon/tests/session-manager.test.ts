import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContextBundle, ModelState, PromptEnvelope, ResolvedAgent } from "@browser-acp/shared-types";
import { SessionManager } from "@browser-acp/runtime-core";
import { createSessionService } from "../src/application/sessionService.js";
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
      getModelState: vi.fn().mockReturnValue(null),
      setModel: vi.fn().mockResolvedValue(null),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const runtimeTwo = {
      sessionId: "session-2",
      getModelState: vi.fn().mockReturnValue(null),
      setModel: vi.fn().mockResolvedValue(null),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const resumedRuntimeOne = {
      sessionId: "session-1",
      getModelState: vi.fn().mockReturnValue(null),
      setModel: vi.fn().mockResolvedValue(null),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
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

  it("loads agent models with non-interactive startup limits", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
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
    const models: ModelState = {
      currentModelId: "fast",
      availableModels: [
        {
          modelId: "fast",
          name: "Fast",
        },
      ],
    };
    const runtime = {
      sessionId: "model-probe-session",
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn().mockResolvedValue(runtime);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      modelProbeTimeoutMs: 1234,
      createRuntime,
    });

    await expect(manager.getAgentModels(agent)).resolves.toEqual(models);

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "mock-agent",
        resumeSessionId: undefined,
        allowAuthentication: false,
        startupTimeoutMs: 1234,
      }),
    );
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("uses a longer default timeout for cold agent model probes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const agent: ResolvedAgent = {
      id: "github-copilot",
      name: "GitHub Copilot",
      source: "user",
      distribution: {
        type: "custom",
        command: "npx",
      },
      status: "ready",
      launchCommand: "npx",
      launchArgs: ["@github/copilot-language-server", "--acp", "--stdio"],
    };
    const models: ModelState = {
      currentModelId: "gpt-5",
      availableModels: [
        {
          modelId: "gpt-5",
          name: "GPT-5",
        },
      ],
    };
    const runtime = {
      sessionId: "model-probe-session",
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn().mockResolvedValue(runtime);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      createRuntime,
    });

    await expect(manager.getAgentModels(agent)).resolves.toEqual(models);

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        allowAuthentication: false,
        startupTimeoutMs: 30000,
      }),
    );
  });

  it("uses a longer timeout for interactive agent authentication", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const agent: ResolvedAgent = {
      id: "github-copilot",
      name: "GitHub Copilot",
      source: "user",
      distribution: {
        type: "custom",
        command: "copilot",
      },
      status: "ready",
      launchCommand: "copilot",
      launchArgs: ["--acp"],
    };
    const models: ModelState = {
      currentModelId: "gpt-5",
      availableModels: [
        {
          modelId: "gpt-5",
          name: "GPT-5",
        },
      ],
    };
    const runtime = {
      sessionId: "auth-session",
      getAuthMethods: vi.fn().mockReturnValue([]),
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn().mockResolvedValue(runtime);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      modelProbeTimeoutMs: 1234,
      agentAuthenticationTimeoutMs: 5678,
      createRuntime,
    });

    await expect(manager.authenticateAgent(agent, "github_oauth")).resolves.toMatchObject({
      state: "authenticated",
      models,
    });

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        allowAuthentication: true,
        authenticationMethodId: "github_oauth",
        startupTimeoutMs: 5678,
      }),
    );
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("allows slow browser OAuth flows by default", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const agent: ResolvedAgent = {
      id: "gemini-cli",
      name: "Gemini CLI",
      source: "user",
      distribution: {
        type: "custom",
        command: "gemini",
      },
      status: "ready",
      launchCommand: "gemini",
      launchArgs: ["--experimental-acp"],
    };
    const models: ModelState = {
      currentModelId: "gemini",
      availableModels: [
        {
          modelId: "gemini",
          name: "Gemini",
        },
      ],
    };
    const runtime = {
      sessionId: "oauth-auth-session",
      getAuthMethods: vi.fn().mockReturnValue([]),
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn().mockResolvedValue(runtime);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      createRuntime,
    });

    await expect(manager.authenticateAgent(agent, "oauth-personal")).resolves.toMatchObject({
      state: "authenticated",
      models,
    });

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        allowAuthentication: true,
        authenticationMethodId: "oauth-personal",
        startupTimeoutMs: 10 * 60 * 1000,
      }),
    );
  });

  it("shares an in-flight agent model probe for concurrent requests", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
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
    const models: ModelState = {
      currentModelId: "fast",
      availableModels: [
        {
          modelId: "fast",
          name: "Fast",
        },
      ],
    };
    const runtime = {
      sessionId: "model-probe-session",
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    let resolveRuntime!: (value: typeof runtime) => void;
    const runtimePromise = new Promise<typeof runtime>((resolve) => {
      resolveRuntime = resolve;
    });
    const createRuntime = vi.fn().mockReturnValue(runtimePromise);

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      createRuntime,
    });

    const firstRequest = manager.getAgentModels(agent);
    const secondRequest = manager.getAgentModels(agent);

    expect(createRuntime).toHaveBeenCalledTimes(1);
    resolveRuntime(runtime);
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([models, models]);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("returns probed agent models even when probe runtime disposal hangs", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
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
    const models: ModelState = {
      currentModelId: "fast",
      availableModels: [
        {
          modelId: "fast",
          name: "Fast",
        },
      ],
    };
    const runtime = {
      sessionId: "model-probe-session",
      getModelState: vi.fn().mockReturnValue(models),
      setModel: vi.fn().mockResolvedValue(models),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      resolvePermission: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(() => new Promise<never>(() => undefined)),
    };

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      createRuntime: vi.fn().mockResolvedValue(runtime),
    });

    await expect(withTimeout(manager.getAgentModels(agent), 20)).resolves.toEqual(models);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("times out model probes that never finish startup", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-runtime-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const agent: ResolvedAgent = {
      id: "slow-agent",
      name: "Slow Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: "slow-agent",
      },
      status: "ready",
      launchCommand: "slow-agent",
      launchArgs: ["--acp"],
    };

    const manager = new SessionManager({
      store,
      defaultCwd: rootDir,
      modelProbeTimeoutMs: 1,
      createRuntime: vi.fn(() => new Promise<never>(() => undefined)),
    });

    await expect(manager.getAgentModels(agent)).rejects.toThrow("Model probe timed out after 1ms");
  });
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
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
