import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationSummary, SessionEvent } from "@browser-acp/shared-types";
import { SessionStore } from "../src/store/sessionStore.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("SessionStore", () => {
  it("persists summaries and transcript events in JSON + JSONL form", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-store-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const summary: ConversationSummary = {
      id: "session-1",
      agentId: "gemini-cli",
      agentName: "Gemini CLI",
      title: "Summarize this article",
      pageTitle: "ACP Overview",
      pageUrl: "https://agentclientprotocol.com/get-started/introduction",
      createdAt: "2026-04-07T06:00:00.000Z",
      lastActivityAt: "2026-04-07T06:00:00.000Z",
      active: true,
      readOnly: false,
    };
    const events: SessionEvent[] = [
      {
        type: "session.started",
        sessionId: "session-1",
        summary,
      },
      {
        type: "turn.completed",
        sessionId: "session-1",
        turnId: "turn-1",
        stopReason: "end_turn",
        completedAt: "2026-04-07T06:00:05.000Z",
      }
    ];

    await store.saveSummary(summary);

    for (const event of events) {
      await store.appendEvent(summary.id, event);
    }

    const loadedSummaries = await store.listSummaries();
    const transcript = await store.readTranscript(summary.id);

    expect(loadedSummaries).toEqual([summary]);
    expect(transcript).toEqual(events);
  });

  it("serializes concurrent summary saves without dropping entries", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-store-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const summaries = Array.from({ length: 20 }, (_, index): ConversationSummary => ({
      id: `session-${index}`,
      agentId: "codex-cli",
      agentName: "Codex",
      title: `Prompt ${index}`,
      pageTitle: "ACP Overview",
      pageUrl: "https://agentclientprotocol.com/get-started/introduction",
      createdAt: `2026-04-07T06:00:${String(index).padStart(2, "0")}.000Z`,
      lastActivityAt: `2026-04-07T06:00:${String(index).padStart(2, "0")}.000Z`,
      active: true,
      readOnly: false,
    }));

    await Promise.all(summaries.map((summary) => store.saveSummary(summary)));

    const loadedSummaries = await store.listSummaries();
    expect(loadedSummaries.map((summary) => summary.id).sort()).toEqual(summaries.map((summary) => summary.id).sort());
  });

  it("deletes a summary and its transcript", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-store-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const summary: ConversationSummary = {
      id: "session-delete",
      agentId: "codex-cli",
      agentName: "Codex",
      title: "Delete this chat",
      pageTitle: "Extensions",
      pageUrl: "chrome://extensions/",
      createdAt: "2026-04-27T09:12:35.073Z",
      lastActivityAt: "2026-04-27T09:12:35.073Z",
      active: false,
      readOnly: false,
    };

    await store.saveSummary(summary);
    await store.appendEvent(summary.id, {
      type: "session.started",
      sessionId: summary.id,
      summary,
    });
    await store.deleteSummary(summary.id);

    expect(await store.listSummaries()).toEqual([]);
    expect(await store.readTranscript(summary.id)).toEqual([]);
  });

  it("does not read legacy model state back from persisted summaries or transcript events", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-store-"));
    tempDirs.push(rootDir);

    const store = new SessionStore(rootDir);
    const legacySummary = {
      id: "session-with-models",
      agentId: "codex-cli",
      agentName: "Codex",
      title: "Legacy chat",
      pageTitle: "Extensions",
      pageUrl: "chrome://extensions/",
      createdAt: "2026-04-27T09:12:35.073Z",
      lastActivityAt: "2026-04-27T09:12:35.073Z",
      active: false,
      readOnly: false,
      models: {
        currentModelId: "gpt-5.5/high",
        availableModels: [
          {
            modelId: "gpt-5.5/high",
            name: "GPT-5.5 (high)",
          },
        ],
      },
    };

    await store.saveSummary(legacySummary as ConversationSummary);
    await store.appendEvent(legacySummary.id, {
      type: "session.started",
      sessionId: legacySummary.id,
      summary: legacySummary,
    } as SessionEvent);

    const loadedSummary = (await store.listSummaries())[0] as ConversationSummary & { models?: unknown };
    const loadedEvent = (await store.readTranscript(legacySummary.id))[0] as Extract<SessionEvent, { type: "session.started" }> & {
      summary: ConversationSummary & { models?: unknown };
    };

    expect(loadedSummary.models).toBeUndefined();
    expect(loadedEvent.summary.models).toBeUndefined();
  });
});
