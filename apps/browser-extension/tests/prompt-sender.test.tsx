import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  BrowserContextBundle,
  ConversationSummary,
  PromptEnvelope,
} from "@browser-acp/shared-types";
import type { OptimisticPrompt, SessionSocketStatus } from "@browser-acp/client-core";
import type { BrowserAcpSocket } from "../src/host-api/agentConsoleHost";
import { usePromptSender } from "../src/ui/sidepanel/hooks/usePromptSender";

const context: BrowserContextBundle = {
  tabId: 1,
  url: "https://example.com",
  title: "Example",
  selectionText: "selected",
  summaryMarkdown: "",
  openTabsPreview: [],
  capturedAt: "2026-04-20T01:00:00.000Z",
};

const refreshedContext: BrowserContextBundle = {
  ...context,
  tabId: 2,
  title: "Fresh Example",
  capturedAt: "2026-04-20T01:01:00.000Z",
};

const summary: ConversationSummary = {
  id: "session-2",
  agentId: "agent-1",
  agentName: "Agent",
  title: "Fresh Example",
  pageTitle: "Fresh Example",
  pageUrl: "https://example.com",
  createdAt: "2026-04-20T01:01:00.000Z",
  lastActivityAt: "2026-04-20T01:01:00.000Z",
  active: true,
  readOnly: false,
};

describe("usePromptSender", () => {
  it("refreshes context and sends prompts through an open existing session socket", async () => {
    const sendPrompt = vi.fn();
    const recordPanelLog = vi.fn();
    const socketRef = {
      current: {
        sendPrompt,
        resolvePermission: vi.fn(),
        close: vi.fn(),
      } satisfies BrowserAcpSocket,
    };
    const pendingPromptRef = {
      current: null as PromptEnvelope | null,
    };
    const socketStatusRef = {
      current: "open" as SessionSocketStatus,
    };
    const bridge = {
      getActiveContext: vi.fn().mockResolvedValue(refreshedContext),
      createSession: vi.fn(),
      getDebugState: vi.fn(),
    };

    const { result } = renderHook(() => {
      const [currentContext, setContext] = useState<BrowserContextBundle | null>(context);
      const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
      return {
        optimisticPrompts,
        ...usePromptSender({
          bridge,
          hostReady: true,
          context: currentContext,
          activeAgentId: "agent-1",
          selectedAgentId: "agent-1",
          selectedSessionId: "session-1",
          socketRef,
          socketStatusRef,
          pendingPromptRef,
          setSocketReconnectVersion: vi.fn(),
          setContext,
          setOptimisticPrompts,
          setSessions: vi.fn(),
          setSelectedSessionId: vi.fn(),
          setSelectedAgentId: vi.fn(),
          setError: vi.fn(),
          setDebugState: vi.fn(),
          recordPanelLog,
        }),
      };
    });

    await act(async () => {
      await result.current.sendPrompt("  Hello  ");
    });

    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Hello",
      context: refreshedContext,
    }));
    expect(result.current.optimisticPrompts[0]).toEqual(expect.objectContaining({
      agentId: "agent-1",
      text: "Hello",
    }));
    expect(pendingPromptRef.current).toBeNull();
  });

  it("creates a session and queues the prompt until the new websocket opens", async () => {
    const recordPanelLog = vi.fn();
    const pendingPromptRef = {
      current: null as PromptEnvelope | null,
    };
    const bridge = {
      getActiveContext: vi.fn().mockResolvedValue(refreshedContext),
      createSession: vi.fn().mockResolvedValue(summary),
      getDebugState: vi.fn(),
    };

    const { result } = renderHook(() => {
      const [sessions, setSessions] = useState<ConversationSummary[]>([]);
      const [selectedSessionId, setSelectedSessionId] = useState("");
      const [selectedAgentId, setSelectedAgentId] = useState("agent-1");
      const [currentContext, setContext] = useState<BrowserContextBundle | null>(context);
      const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);

      return {
        sessions,
        selectedSessionId,
        selectedAgentId,
        optimisticPrompts,
        ...usePromptSender({
          bridge,
          hostReady: true,
          context: currentContext,
          activeAgentId: "agent-1",
          selectedAgentId,
          selectedSessionId,
          socketRef: {
            current: null,
          },
          socketStatusRef: {
            current: "idle" as SessionSocketStatus,
          },
          pendingPromptRef,
          setSocketReconnectVersion: vi.fn(),
          setContext,
          setOptimisticPrompts,
          setSessions,
          setSelectedSessionId,
          setSelectedAgentId,
          setError: vi.fn(),
          setDebugState: vi.fn(),
          recordPanelLog,
        }),
      };
    });

    await act(async () => {
      await result.current.sendPrompt("Create one");
    });

    expect(bridge.createSession).toHaveBeenCalledWith("agent-1", refreshedContext);
    expect(result.current.sessions).toEqual([summary]);
    expect(result.current.selectedSessionId).toBe("session-2");
    expect(pendingPromptRef.current).toEqual(expect.objectContaining({
      sessionId: "session-2",
      agentId: "agent-1",
      text: "Create one",
    }));
  });
});
