import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContextBundle, ConversationSummary, ModelState, ResolvedAgent } from "@browser-acp/shared-types";
import { createDaemonApp } from "../src/server.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("daemon auth and model cache", () => {
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
