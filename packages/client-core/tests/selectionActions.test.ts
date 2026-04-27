import { describe, expect, it } from "vitest";
import {
  canProcessSelectionAction,
  shouldHandleSelectionActionSignal,
} from "../src/index.js";

const context = {
  tabId: 1,
  url: "https://example.com",
  title: "Example",
  selectionText: "selected",
  summaryMarkdown: "",
  openTabsPreview: [],
  capturedAt: "2026-04-26T00:00:00.000Z",
};

describe("selection action helpers", () => {
  it("ignores empty or already handled selection action signals", () => {
    expect(shouldHandleSelectionActionSignal(0, 0)).toBe(false);
    expect(shouldHandleSelectionActionSignal(2, 2)).toBe(false);
    expect(shouldHandleSelectionActionSignal(3, 2)).toBe(true);
  });

  it("requires host readiness, context, agent, and no in-flight processing", () => {
    expect(canProcessSelectionAction({ hostReady: true, context, agentId: "agent-1", inFlight: false })).toBe(true);
    expect(canProcessSelectionAction({ hostReady: false, context, agentId: "agent-1", inFlight: false })).toBe(false);
    expect(canProcessSelectionAction({ hostReady: true, context: null, agentId: "agent-1", inFlight: false })).toBe(false);
    expect(canProcessSelectionAction({ hostReady: true, context, agentId: "", inFlight: false })).toBe(false);
    expect(canProcessSelectionAction({ hostReady: true, context, agentId: "agent-1", inFlight: true })).toBe(false);
  });
});
