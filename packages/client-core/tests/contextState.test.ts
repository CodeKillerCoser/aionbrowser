import { describe, expect, it } from "vitest";
import type { BrowserContextBundle } from "@browser-acp/shared-types";
import { keepNewerContext } from "../src/index.js";

describe("keepNewerContext", () => {
  it("uses the next context when no current context exists", () => {
    const next = createContext("2026-04-24T00:00:01.000Z", "Next");

    expect(keepNewerContext(null, next)).toBe(next);
  });

  it("keeps the newer captured context", () => {
    const current = createContext("2026-04-24T00:00:03.000Z", "Current");
    const older = createContext("2026-04-24T00:00:02.000Z", "Older");
    const newer = createContext("2026-04-24T00:00:04.000Z", "Newer");

    expect(keepNewerContext(current, older)).toBe(current);
    expect(keepNewerContext(current, newer)).toBe(newer);
  });
});

function createContext(capturedAt: string, title: string): BrowserContextBundle {
  return {
    tabId: 1,
    url: "https://example.com",
    title,
    selectionText: "",
    summaryMarkdown: "",
    openTabsPreview: [],
    capturedAt,
  };
}
