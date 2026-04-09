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
});
