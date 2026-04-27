import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationSummary, ResolvedAgent } from "@browser-acp/shared-types";
import { ConversationDebugPanel, ConversationHeader, ConversationSidebar, TranscriptPane } from "@browser-acp/ui-react";

describe("conversation layout", () => {
  it("renders the conversation title, agent name, debug switch, and error", () => {
    const onDebugChange = vi.fn();

    render(
      <ConversationHeader
        title="Debug Session"
        subtitle="Qoder CLI"
        debugEnabled={false}
        error="Connection lost"
        onDebugChange={onDebugChange}
      />,
    );

    expect(screen.getByRole("heading", { name: "Debug Session" })).toBeInTheDocument();
    expect(screen.getByText("Qoder CLI")).toBeInTheDocument();
    expect(screen.getByText("Connection lost")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Debug" }));

    expect(onDebugChange).toHaveBeenCalledWith(true);
  });

  it("renders an empty transcript pane with the session event log landmark", () => {
    render(
      <TranscriptPane
        viewportRef={createRef<HTMLDivElement>()}
        messages={[]}
        emptyMessage="选择一个 Agent，然后开始提问。"
        isPermissionSubmitting={() => false}
        onResolvePermission={vi.fn()}
      />,
    );

    expect(screen.getByTestId("session-event-log")).toBeInTheDocument();
    expect(screen.getByText("选择一个 Agent，然后开始提问。")).toBeInTheDocument();
  });

  it("renders sidebar agents and sessions with selection callbacks", () => {
    const onSelectAgent = vi.fn();
    const onSelectSession = vi.fn();
    const onStartNewSession = vi.fn();
    const onOpenSettings = vi.fn();
    const onToggleCollapsed = vi.fn();
    const agents: ResolvedAgent[] = [
      {
        id: "qoder-cli",
        name: "Qoder CLI",
        source: "registry",
        distribution: {
          type: "binary",
          command: "qoder",
        },
        status: "ready",
        launchCommand: "qoder",
        launchArgs: ["--acp"],
      },
    ];
    const sessions: ConversationSummary[] = [
      {
        id: "session-1",
        agentId: "qoder-cli",
        agentName: "Qoder CLI",
        title: "Rust display trait",
        pageTitle: "Rust",
        pageUrl: "https://example.com/rust",
        lastActivityAt: "2026-04-24T00:00:00.000Z",
        createdAt: "2026-04-24T00:00:00.000Z",
        active: true,
        readOnly: false,
      },
    ];

    render(
      <ConversationSidebar
        agents={agents}
        sessions={sessions}
        selectedAgentId="qoder-cli"
        selectedSessionId="session-1"
        collapsed={false}
        getAgentIconSrc={() => undefined}
        getAgentLocalPath={(agent) => agent.launchCommand}
        onOpenSettings={onOpenSettings}
        onSelectAgent={onSelectAgent}
        onSelectSession={onSelectSession}
        onStartNewSession={onStartNewSession}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Qoder CLI ready" }));
    fireEvent.click(screen.getByRole("button", { name: "Rust display trait" }));
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onSelectAgent).toHaveBeenCalledWith(agents[0]);
    expect(onSelectSession).toHaveBeenCalledWith(sessions[0]);
    expect(onStartNewSession).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("renders a host-provided debug panel and refresh action", () => {
    const onRefresh = vi.fn();

    render(
      <ConversationDebugPanel
        contextHeading="Current Page"
        contextTitle="Rust docs"
        contextUrl="https://example.com/rust"
        selectedText="impl Display"
        diagnosticsText="runtime is ready"
        onRefreshDiagnostics={onRefresh}
      />,
    );

    expect(screen.getByRole("heading", { name: "Current Page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/rust" })).toHaveAttribute(
      "href",
      "https://example.com/rust",
    );
    expect(screen.getByText("impl Display")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
