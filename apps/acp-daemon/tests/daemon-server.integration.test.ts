import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { BrowserContextBundle, ResolvedAgent, SessionSocketServerMessage } from "@browser-acp/shared-types";
import { createDaemonApp } from "../src/server.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("createDaemonApp", () => {
  it("serves health, agents, sessions, and websocket prompt streaming", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-daemon-"));
    tempDirs.push(rootDir);

    const agent: ResolvedAgent = {
      id: "mock-agent",
      name: "Mock Agent",
      description: "Fixture ACP agent",
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
    const context: BrowserContextBundle = {
      tabId: 42,
      url: "https://example.com/post",
      title: "Example post",
      selectionText: "Selected quote",
      summaryMarkdown: "Summary body",
      openTabsPreview: [],
      capturedAt: "2026-04-07T07:30:00.000Z",
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

    const health = await fetch(`${baseUrl}/health`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    const agents = await fetch(`${baseUrl}/agents`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    const created = await fetch(`${baseUrl}/sessions`, {
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

    expect(health.status).toBe(200);
    expect(await agents.json()).toEqual([agent]);

    const summary = (await created.json()) as { id: string };
    expect(summary.id).toBeTruthy();

    const wsEvents = await new Promise<SessionSocketServerMessage[]>((resolvePromise, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/sessions/${summary.id}?token=test-token`);
      const messages: SessionSocketServerMessage[] = [];

      socket.once("open", () => {
        socket.send(JSON.stringify({
          type: "sendPrompt",
          prompt: {
            sessionId: summary.id,
            agentId: agent.id,
            text: "Explain what is selected.",
            context,
          },
        }));
      });

      socket.on("message", (buffer: Buffer) => {
        const message = JSON.parse(buffer.toString()) as SessionSocketServerMessage;
        messages.push(message);

        if (message.type === "error") {
          socket.close();
          reject(new Error(message.error ?? "Unknown websocket error"));
          return;
        }

        if (message.type === "event" && message.event?.type === "permission.requested") {
          socket.send(JSON.stringify({
            type: "resolvePermission",
            decision: {
              permissionId: message.event.permissionId,
              outcome: "selected",
              optionId: message.event.options[0]?.optionId,
            },
          }));
          return;
        }

        if (message.type === "event" && message.event?.type === "turn.completed") {
          socket.close();
          resolvePromise(messages);
        }
      });

      socket.once("error", reject);
    });

    const listedSessions = await fetch(`${baseUrl}/sessions`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    const debugLogsResponse = await fetch(`${baseUrl}/debug/logs`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    await app.stop();

    expect(wsEvents.some((message) => message.type === "event" && message.event?.type === "turn.delta")).toBe(true);
    expect((await listedSessions.json()) as Array<{ id: string }>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: summary.id }),
      ]),
    );
    expect(debugLogsResponse.status).toBe(200);
    expect((await debugLogsResponse.json()) as Array<{ message: string }>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "runtime session spawn started" }),
        expect.objectContaining({ message: "websocket prompt received" }),
        expect.objectContaining({ message: "prompt request completed" }),
      ]),
    );
  }, 10000);
});
