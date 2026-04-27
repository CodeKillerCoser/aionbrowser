import { describe, expect, it } from "vitest";
import {
  PENDING_SESSION_ID,
  buildPromptEnvelope,
  canSubmitPrompt,
} from "../src/index.js";

const context = {
  tabId: 1,
  url: "https://example.com",
  title: "Example",
  selectionText: "",
  summaryMarkdown: "",
  openTabsPreview: [],
  capturedAt: "2026-04-26T00:00:00.000Z",
};

describe("prompt submission helpers", () => {
  it("requires host readiness, context, agent id, and non-empty text", () => {
    expect(canSubmitPrompt({ hostReady: true, context, agentId: "agent-1", text: " hello " })).toBe(true);
    expect(canSubmitPrompt({ hostReady: false, context, agentId: "agent-1", text: "hello" })).toBe(false);
    expect(canSubmitPrompt({ hostReady: true, context: null, agentId: "agent-1", text: "hello" })).toBe(false);
    expect(canSubmitPrompt({ hostReady: true, context, agentId: "", text: "hello" })).toBe(false);
    expect(canSubmitPrompt({ hostReady: true, context, agentId: "agent-1", text: "   " })).toBe(false);
  });

  it("builds prompt envelopes with a pending session fallback and trimmed text", () => {
    expect(buildPromptEnvelope({ sessionId: "", agentId: "agent-1", text: " hello ", context })).toEqual({
      sessionId: PENDING_SESSION_ID,
      agentId: "agent-1",
      text: "hello",
      context,
    });
  });
});
