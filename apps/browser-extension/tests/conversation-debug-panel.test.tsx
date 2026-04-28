import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationDebugPanel } from "@browser-acp/ui-react";
import type { BrowserContextTimelineEntry } from "@browser-acp/shared-types";

describe("ConversationDebugPanel", () => {
  it("renders browser context timeline entries", () => {
    const contextHistory: BrowserContextTimelineEntry[] = [
      {
        id: "ctx-1",
        reason: "tabs.onActivated",
        capturedAt: "2026-04-27T00:00:00.000Z",
        context: {
          tabId: 1,
          title: "Example Page",
          url: "https://example.com",
          selectionText: "Selected text",
          summaryMarkdown: "Summary",
          openTabsPreview: [],
          capturedAt: "2026-04-27T00:00:00.000Z",
        },
      },
    ];

    render(
      <ConversationDebugPanel
        contextHeading="Current Page"
        contextTitle="Example Page"
        contextUrl="https://example.com"
        selectedText="Selected text"
        diagnosticsText="logs"
        contextHistory={contextHistory}
        onRefreshDiagnostics={vi.fn()}
      />,
    );

    expect(screen.getByText("Browser Context Timeline")).toBeInTheDocument();
    expect(screen.getByText("tabs.onActivated")).toBeInTheDocument();
    expect(screen.getAllByText("Example Page").length).toBeGreaterThan(1);
  });
});
