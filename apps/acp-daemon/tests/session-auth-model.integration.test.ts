import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentAuthStatus,
  BrowserContextBundle,
  ConversationSummary,
  ModelState,
  ResolvedAgent,
} from "@browser-acp/shared-types";
import { createDaemonApp } from "../src/server.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("daemon auth and model cache", () => {
  it("reports unauthenticated agent status without creating a session", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-auth-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/auth`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("unauthenticated");
      expect(auth.methods.map((method) => method.id)).toEqual(["browser", "api-key"]);
      expect(auth.methods[0]).toMatchObject({
        id: "browser",
        type: "agent",
      });
      expect(auth.methods[1]).toMatchObject({
        id: "api-key",
        type: "env_var",
        link: "https://example.com/api-key",
        vars: [
          {
            name: "MOCK_AGENT_API_KEY",
            label: "Mock API key",
            secret: true,
          },
        ],
      });

      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect(storedSessions).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("authenticates an agent explicitly and returns models without creating a session", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-login-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          methodId: "browser",
        }),
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("authenticated");
      expect(auth.models?.currentModelId).toBe("fast");
      expect(auth.models?.availableModels.map((model) => model.modelId)).toEqual(["fast", "smart"]);

      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect(storedSessions).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("authenticates an env var method by passing credentials to the agent process", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-env-login-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          methodId: "api-key",
          env: {
            MOCK_AGENT_API_KEY: "test-api-key",
          },
        }),
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("authenticated");
      expect(auth.models?.availableModels.map((model) => model.modelId)).toEqual(["fast", "smart"]);

      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect(storedSessions).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("treats auth methods that explicitly mention env vars as credential methods", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-gemini-api-key-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "api-key-fixture-agent",
      name: "API Key Fixture Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-api-key-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-api-key-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/auth`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("unauthenticated");
      expect(auth.methods[0]).toMatchObject({
        id: "gemini-api-key",
        type: "env_var",
      });
      expect(auth.methods[0].vars).toEqual([]);
      expect(auth.methods[1]).toMatchObject({
        id: "gemini-description-only",
        type: "env_var",
      });
      expect(auth.methods[1].vars).toEqual([
        {
          name: "GEMINI_API_KEY",
          label: null,
          optional: false,
          secret: true,
        },
      ]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("authenticates an explicitly selected agent method after initializing the session", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-gemini-oauth-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "api-key-fixture-agent",
      name: "API Key Fixture Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-api-key-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-api-key-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          methodId: "gemini-oauth",
        }),
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("authenticated");
      expect(auth.models?.availableModels.map((model) => model.modelId)).toEqual(["gemini-2.5-pro"]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("does not accept API key authentication when the agent returns no models", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-empty-env-login-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          methodId: "api-key",
          env: {
            MOCK_AGENT_API_KEY: "test-api-key",
            MOCK_AGENT_EMPTY_MODELS: "1",
          },
        }),
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("unauthenticated");
      expect(auth.error).toContain("没有返回可用模型");
      expect(auth.models?.availableModels ?? []).toEqual([]);

      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect(storedSessions).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("returns the current qoder login command when qoder reports the old slash command", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-qoder-login-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "qoder-login-agent",
      name: "Qoder Login Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-qoder-login-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-qoder-login-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const authResponse = await fetch(`${baseUrl}/agents/${agent.id}/authenticate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          methodId: "qodercli-login",
        }),
      });
      const auth = await authResponse.json() as AgentAuthStatus;

      expect(authResponse.status).toBe(200);
      expect(auth.state).toBe("unavailable");
      expect(auth.error).toContain("qodercli login");
      expect(auth.error).not.toContain("qodercli /login");
    } finally {
      await app.stop();
    }
  }, 10000);

  it("does not trigger interactive authentication while probing agent models", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-model-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const modelsResponse = await fetch(`${baseUrl}/agents/${agent.id}/model`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const error = await modelsResponse.json() as { error?: string };

      expect(modelsResponse.status).toBe(500);
      expect(error.error).toBe("Authentication required");

      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect(storedSessions).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10000);

  it("authenticates when loading models and keeps model state out of persisted sessions", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-auth-model-"));
    tempDirs.push(rootDir);
    const agent: ResolvedAgent = {
      id: "auth-model-agent",
      name: "Auth Model Agent",
      source: "user",
      distribution: {
        type: "custom",
        command: process.execPath,
        args: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
      },
      status: "ready",
      launchCommand: process.execPath,
      launchArgs: [resolve("tests/fixtures/mock-auth-model-agent.mjs")],
    };
    const context: BrowserContextBundle = {
      tabId: 1,
      url: "https://example.com",
      title: "Example",
      selectionText: "",
      summaryMarkdown: "",
      openTabsPreview: [],
      capturedAt: "2026-04-27T06:00:00.000Z",
    };

    const app = createDaemonApp({
      token: "test-token",
      port: 0,
      rootDir,
      defaultCwd: rootDir,
      listAgents: async () => [agent],
    });
    const server = await app.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;

    try {
      const createdResponse = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: agent.id,
          context,
        }),
      });
      const created = await createdResponse.json() as ConversationSummary;

      expect(createdResponse.status).toBe(200);
      expect("models" in created).toBe(false);

      const modelsResponse = await fetch(`${baseUrl}/sessions/${created.id}/model`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      });
      const models = await modelsResponse.json() as ModelState;

      expect(modelsResponse.status).toBe(200);
      expect(models.currentModelId).toBe("fast");
      expect(models.availableModels.map((model) => model.modelId)).toEqual(["fast", "smart"]);

      const changedResponse = await fetch(`${baseUrl}/sessions/${created.id}/model`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelId: "smart",
        }),
      });
      const changed = await changedResponse.json() as ModelState;

      expect(changedResponse.status).toBe(200);
      expect(changed.currentModelId).toBe("smart");
      const storedSessions = await fetch(`${baseUrl}/sessions`, {
        headers: {
          Authorization: "Bearer test-token",
        },
      }).then((response) => response.json()) as ConversationSummary[];
      expect("models" in storedSessions[0]!).toBe(false);
    } finally {
      await app.stop();
    }
  }, 10000);
});
