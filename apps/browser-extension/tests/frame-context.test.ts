import { describe, expect, it } from "vitest";
import { mergeFramePageContexts } from "../src/frameContext";

describe("mergeFramePageContexts", () => {
  it("prefers the focused frame when choosing selected text and summary", () => {
    const merged = mergeFramePageContexts([
      {
        url: "https://example.com",
        title: "Top frame",
        selectionText: "",
        summaryMarkdown: "Top frame summary",
        hasFocus: false,
      },
      {
        url: "https://example.com/frame",
        title: "Focused frame",
        selectionText: "Focused selection",
        summaryMarkdown: "Focused summary",
        hasFocus: true,
      },
    ]);

    expect(merged.selectionText).toBe("Focused selection");
    expect(merged.summaryMarkdown).toBe("Focused summary");
    expect(merged.hasFocus).toBe(true);
  });
});
