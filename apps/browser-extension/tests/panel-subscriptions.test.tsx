import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { BrowserContextBundle } from "@browser-acp/shared-types";
import { useActiveContextSubscription } from "../src/ui/sidepanel/hooks/useActiveContextSubscription";
import { useSelectionActionSubscription } from "../src/ui/sidepanel/hooks/useSelectionActionSubscription";
import { useScrollToLatestTranscriptItem } from "../src/ui/sidepanel/hooks/useScrollToLatestTranscriptItem";

const olderContext: BrowserContextBundle = {
  tabId: 1,
  url: "https://example.com/older",
  title: "Older page",
  selectionText: "",
  summaryMarkdown: "",
  openTabsPreview: [],
  capturedAt: "2026-04-20T01:00:00.000Z",
};

const newerContext: BrowserContextBundle = {
  tabId: 2,
  url: "https://example.com/newer",
  title: "Newer page",
  selectionText: "selected",
  summaryMarkdown: "summary",
  openTabsPreview: [],
  capturedAt: "2026-04-20T02:00:00.000Z",
};

describe("panel subscriptions", () => {
  it("syncs active browser context updates through the bridge and unsubscribes on cleanup", () => {
    let listener: ((context: BrowserContextBundle) => void) | undefined;
    const unsubscribe = vi.fn();
    const recordPanelLog = vi.fn();
    const bridge = {
      subscribeToActiveContext: vi.fn((nextListener: (context: BrowserContextBundle) => void) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };

    const { result, unmount } = renderHook(() => {
      const [context, setContext] = useState<BrowserContextBundle | null>(newerContext);
      useActiveContextSubscription({
        bridge,
        setContext,
        recordPanelLog,
      });
      return context;
    });

    act(() => {
      listener?.(olderContext);
    });

    expect(result.current).toBe(newerContext);

    act(() => {
      listener?.(newerContext);
    });

    expect(result.current).toBe(newerContext);
    expect(recordPanelLog).toHaveBeenCalledWith("active context synchronized", {
      tabId: newerContext.tabId,
      title: newerContext.title,
      url: newerContext.url,
      selectionLength: newerContext.selectionText.length,
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("notifies the panel when a selection action is published and unsubscribes on cleanup", () => {
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const onSignal = vi.fn();
    const recordPanelLog = vi.fn();
    const bridge = {
      subscribeToSelectionActions: vi.fn((nextListener: () => void) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };

    const { unmount } = renderHook(() =>
      useSelectionActionSubscription({
        bridge,
        onSignal,
        recordPanelLog,
      }),
    );

    act(() => {
      listener?.();
    });

    expect(onSignal).toHaveBeenCalledOnce();
    expect(recordPanelLog).toHaveBeenCalledWith("selection action notification received");

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("scrolls the transcript viewport to the latest item when the dependency changes", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 480,
    });

    const viewportRef = {
      current: viewport,
    };

    const { rerender } = renderHook(
      ({ itemCount }) => useScrollToLatestTranscriptItem(viewportRef, itemCount),
      {
        initialProps: {
          itemCount: 1,
        },
      },
    );

    expect(viewport.scrollTop).toBe(480);

    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 720,
    });

    rerender({
      itemCount: 2,
    });

    expect(viewport.scrollTop).toBe(720);
  });
});
