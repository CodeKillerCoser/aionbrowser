import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentSpec,
  BrowserContextBundle,
  ConversationSummary,
  NativeHostBootstrapResponse,
  PromptEnvelope,
  ResolvedAgent,
  SessionSocketServerMessage,
  AgentSpecCandidate,
} from "@browser-acp/shared-types";
import { BrowserAcpPanel, type BrowserAcpBridge, type BrowserAcpSocket } from "../src/ui/sidepanel/BrowserAcpPanel";
import type { BackgroundDebugState } from "../src/messages";

const context: BrowserContextBundle = {
  tabId: 8,
  url: "https://example.com/post",
  title: "Example post",
  selectionText: "Important sentence",
  summaryMarkdown: "Summary excerpt",
  openTabsPreview: [],
  capturedAt: "2026-04-07T08:00:00.000Z",
};

const refreshedContext: BrowserContextBundle = {
  tabId: 9,
  url: "https://example.com/other",
  title: "Other page",
  selectionText: "Fresh selection",
  summaryMarkdown: "Fresh summary",
  openTabsPreview: [
    {
      tabId: 9,
      title: "Other page",
      url: "https://example.com/other",
      active: true,
    },
  ],
  capturedAt: "2026-04-08T09:00:00.000Z",
};

const bootstrap: NativeHostBootstrapResponse = {
  ok: true,
  port: 9000,
  token: "token",
};

const agents: ResolvedAgent[] = [
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@google/gemini-cli", "--acp"],
      packageName: "@google/gemini-cli",
    },
    status: "ready",
    launchCommand: "gemini",
    launchArgs: ["--acp"],
  },
  {
    id: "mock-agent",
    name: "Mock Agent",
    source: "user",
    distribution: {
      type: "custom",
      command: "mock-agent",
    },
    status: "ready",
    launchCommand: "mock-agent",
    launchArgs: [],
  },
];

const sessions: ConversationSummary[] = [
  {
    id: "session-1",
    agentId: "gemini-cli",
    agentName: "Gemini CLI",
    title: "Existing thread",
    pageTitle: "Example post",
    pageUrl: "https://example.com/post",
    createdAt: "2026-04-07T08:00:00.000Z",
    lastActivityAt: "2026-04-07T08:05:00.000Z",
    active: true,
    readOnly: false,
  }
];

const debugState: BackgroundDebugState = {
  extensionId: "fignfifoniblkonapihmkfakmlgkbkcf",
  nativeHostName: "com.browser_acp.host",
  daemonBaseUrl: "http://127.0.0.1",
  bootstrapCache: bootstrap,
  daemonStatus: bootstrap,
  daemonLogs: [
    {
      timestamp: "2026-04-07T08:00:02.000Z",
      scope: "runtime",
      message: "runtime session spawn started",
      details: {
        command: "gemini",
      },
    },
  ],
  logs: [
    {
      timestamp: "2026-04-07T08:00:00.000Z",
      scope: "background",
      message: "ensureDaemon succeeded",
      details: {
        port: 9000,
      },
    },
  ],
};

const agentSpecs: AgentSpec[] = [
  {
    id: "external-custom-agent",
    name: "Mock Agent",
    kind: "external-acp",
    enabled: true,
    icon: {
      kind: "url",
      value: "https://example.com/mock.svg",
    },
    launch: {
      command: "mock-agent",
      args: [],
    },
    createdAt: "2026-04-20T01:00:00.000Z",
    updatedAt: "2026-04-20T01:00:00.000Z",
  },
];

describe("BrowserAcpPanel", () => {
  it("loads agents, sessions, and exposes current context from one debug panel", async () => {
    const bridge = createBridge();

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByRole("button", { name: "Gemini CLI ready" })).toBeInTheDocument();
    expect(screen.getAllByText("Existing thread").length).toBeGreaterThan(0);
    expect(screen.queryByText("Important sentence")).not.toBeInTheDocument();

    await openDebugPanel();

    expect(screen.getByText("Current Page")).toBeInTheDocument();
    expect(screen.getByText("Selected Text")).toBeInTheDocument();
    expect(screen.getByText("Runtime Logs")).toBeInTheDocument();
    expect(screen.getAllByText("Example post").length).toBeGreaterThan(0);
    expect(screen.getByText("https://example.com/post")).toBeInTheDocument();
    expect(screen.getByText("Important sentence")).toBeInTheDocument();
  });

  it("creates a session and sends a prompt through the connected socket", async () => {
    const sendPrompt = vi.fn();
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-2",
        agentId: "mock-agent",
        agentName: "Mock Agent",
        title: "New thread",
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onMessage({
          type: "event",
          event: {
            type: "session.started",
            sessionId,
            summary: {
              ...sessions[0],
              id: sessionId,
            },
          },
        } satisfies SessionSocketServerMessage);

        const socket = {
          sendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });

        return socket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Mock Agent ready" }));
    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Summarize the key claim." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(bridge.createSession).toHaveBeenCalledWith(bootstrap, "mock-agent", context);
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Summarize the key claim.",
          context,
        } satisfies Partial<PromptEnvelope>),
      );
    });
  });

  it("renders the user prompt immediately while the session is still being created", async () => {
    const pendingSession = createDeferred<ConversationSummary>();
    const createSession = vi.fn().mockReturnValue(pendingSession.promise);
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession,
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Mock Agent ready" }));
    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Show this instantly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(document.querySelector(".browser-acp-thread-message-user")?.textContent).toContain("Show this instantly");
      expect(screen.getByLabelText("Assistant loading")).toBeInTheDocument();
    });
    expect(createSession).toHaveBeenCalledWith(bootstrap, "mock-agent", context);

    pendingSession.resolve({
      ...sessions[0],
      id: "session-2",
      agentId: "mock-agent",
      agentName: "Mock Agent",
      title: "Instant thread",
    });
  });

  it("focuses the composer input when the hint row is clicked", async () => {
    const bridge = createBridge();

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    const input = screen.getByPlaceholderText("Ask the current page anything...");

    fireEvent.mouseDown(screen.getByText("Enter to send · Shift+Enter for a new line"));

    expect(input).toHaveFocus();
  });

  it("keeps the sent prompt visible and renders send failures as assistant replies", async () => {
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockRejectedValue(new Error("Daemon request failed: 500")),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Mock Agent ready" }));
    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Keep this even if send fails" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(document.querySelector(".browser-acp-thread-message-user")?.textContent).toContain(
        "Keep this even if send fails",
      );
      expect(document.querySelector(".browser-acp-thread-message-assistant")?.textContent).toContain(
        "Daemon request failed: 500",
      );
    });
    expect(screen.getByPlaceholderText("Ask the current page anything...")).toHaveValue("");
  });

  it("creates an external ACP agent from the settings panel and refreshes the agent list", async () => {
    const createdSpec: AgentSpec = {
      id: "external-new-agent",
      name: "New ACP Agent",
      kind: "external-acp",
      enabled: true,
      icon: {
        kind: "url",
        value: "https://example.com/new.svg",
      },
      launch: {
        command: "new-agent",
        args: ["--acp", "--profile", "dev"],
      },
      createdAt: "2026-04-20T02:00:00.000Z",
      updatedAt: "2026-04-20T02:00:00.000Z",
    };
    const createAgentSpec = vi.fn().mockResolvedValue(createdSpec);
    const listAgents = vi
      .fn()
      .mockResolvedValueOnce(agents)
      .mockResolvedValueOnce([
        ...agents,
        {
          id: createdSpec.id,
          name: createdSpec.name,
          source: "user",
          distribution: {
            type: "custom",
            command: "new-agent",
            args: ["--acp", "--profile", "dev"],
          },
          icon: "https://example.com/new.svg",
          status: "launchable",
          launchCommand: "new-agent",
          launchArgs: ["--acp", "--profile", "dev"],
        } satisfies ResolvedAgent,
      ]);
    const bridge = createBridge({
      listAgents,
      createAgentSpec,
      listAgentSpecs: vi.fn().mockResolvedValue(agentSpecs),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
    expect(await screen.findByRole("button", { name: "返回对话" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Debug" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "New ACP Agent" },
    });
    fireEvent.change(screen.getByLabelText("Launch command"), {
      target: { value: "new-agent" },
    });
    fireEvent.change(screen.getByLabelText("Launch arguments"), {
      target: { value: "--acp --profile dev" },
    });
    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "https://example.com/new.svg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save external agent" }));

    await waitFor(() => {
      expect(createAgentSpec).toHaveBeenCalledWith(bootstrap, {
        name: "New ACP Agent",
        launchCommand: "new-agent",
        launchArgs: ["--acp", "--profile", "dev"],
        icon: {
          kind: "url",
          value: "https://example.com/new.svg",
        },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(await screen.findByRole("button", { name: "New ACP Agent launchable" })).toBeInTheDocument();
  });

  it("adds scanned builtin ACP agents from the settings panel", async () => {
    const candidate: AgentSpecCandidate = {
      catalogId: "gemini-cli",
      name: "Gemini CLI",
      description: "Google's official CLI for Gemini",
      launchCommand: "gemini",
      launchArgs: ["--experimental-acp"],
      detectedCommandPath: "/shell/bin/gemini",
      status: "ready",
      recommended: true,
    };
    const createdSpec: AgentSpec = {
      id: "external-gemini",
      name: "Gemini CLI",
      kind: "external-acp",
      enabled: true,
      launch: {
        command: "gemini",
        args: ["--experimental-acp"],
      },
      createdAt: "2026-04-20T03:00:00.000Z",
      updatedAt: "2026-04-20T03:00:00.000Z",
    };
    const createAgentSpec = vi.fn().mockResolvedValue(createdSpec);
    const bridge = createBridge({
      listAgentSpecs: vi.fn().mockResolvedValue([]),
      listAgentSpecCandidates: vi.fn().mockResolvedValue([candidate]),
      createAgentSpec,
    });

    const { container } = render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));

    expect(await screen.findByText("检测到可添加的 Agent")).toBeInTheDocument();
    expect(screen.getByText("gemini --experimental-acp")).toBeInTheDocument();
    expect(screen.getByText("/shell/bin/gemini")).toBeInTheDocument();
    expect(container.querySelector(".browser-acp-settings-candidate-row .browser-acp-settings-agent-icon img")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加选中的 Agent" }));

    await waitFor(() => {
      expect(createAgentSpec).toHaveBeenCalledWith(bootstrap, {
        name: "Gemini CLI",
        launchCommand: "gemini",
        launchArgs: ["--experimental-acp"],
        description: "Google's official CLI for Gemini",
        icon: undefined,
      });
    });
  });

  it("waits for the session websocket to open before sending the first prompt", async () => {
    const sendPrompt = vi.fn();
    let onStatus:
      | ((status: "open" | "close" | "error", details?: Record<string, unknown>) => void)
      | undefined;
    const connectSession = vi.fn().mockImplementation((_, __, ___, ____, nextOnStatus) => {
      onStatus = nextOnStatus;
      return {
        sendPrompt,
        resolvePermission: vi.fn(),
        close: vi.fn(),
      } satisfies BrowserAcpSocket;
    });
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-2",
        agentId: "mock-agent",
        agentName: "Mock Agent",
      }),
      connectSession,
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "Mock Agent ready" }));
    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Summarize the key claim." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(bridge.createSession).toHaveBeenCalled();
      expect(connectSession).toHaveBeenCalledTimes(1);
    });
    expect(sendPrompt).not.toHaveBeenCalled();

    onStatus?.("open", { sessionId: "session-2" });

    await waitFor(() => {
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-2",
          text: "Summarize the key claim.",
        } satisfies Partial<PromptEnvelope>),
      );
    });
  });

  it("shows visible empty states when no agents or sessions are available", async () => {
    const bridge = createBridge({
      listAgents: vi.fn().mockResolvedValue([]),
      listSessions: vi.fn().mockResolvedValue([]),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("No agents detected yet.")).toBeInTheDocument();
    expect(screen.getByText("No saved sessions yet.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask the current page anything...")).toBeInTheDocument();
  });

  it("claims and sends a pending selection action after the native side panel boots", async () => {
    const sendPrompt = vi.fn();
    const bridge = createBridge({
      claimPendingSelectionAction: vi
        .fn()
        .mockResolvedValueOnce({
          id: "action-1",
          action: "explain",
          selectionText: "Important sentence",
          promptText: "请解释这段内容\\n\\nImportant sentence",
          createdAt: "2026-04-09T04:00:00.000Z",
        })
        .mockResolvedValue(null),
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onMessage({
          type: "event",
          event: {
            type: "session.started",
            sessionId,
            summary: {
              ...sessions[0],
              id: sessionId,
            },
          },
        } satisfies SessionSocketServerMessage);

        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });

        return {
          sendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });

    await waitFor(() => {
      expect(bridge.claimPendingSelectionAction).toHaveBeenCalled();
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "请解释这段内容\\n\\nImportant sentence",
          sessionId: "session-1",
        } satisfies Partial<PromptEnvelope>),
      );
    });
  });

  it("renders a merged assistant message while keeping raw ACP events in the debug panel", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "session.started",
            sessionId,
            summary: {
              ...sessions[0],
              id: sessionId,
            },
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-1",
            prompt: "Summarize this page",
            startedAt: "2026-04-08T03:50:30.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.delta",
            sessionId,
            turnId: null,
            chunk: "",
            role: "system",
            updateKind: "available_commands_update",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.delta",
            sessionId,
            turnId: "turn-1",
            chunk: "Thinking through the answer.",
            role: "system",
            updateKind: "agent_thought_chunk",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.delta",
            sessionId,
            turnId: "turn-1",
            chunk: "Clean assistant reply",
            role: "agent",
            updateKind: "agent_message_chunk",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.completed",
            sessionId,
            turnId: "turn-1",
            stopReason: "end_turn",
            completedAt: "2026-04-08T03:50:31.000Z",
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("Summarize this page")).toBeInTheDocument();
    expect(screen.getByText("Clean assistant reply")).toBeInTheDocument();
    expect(screen.queryByText(/^You$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Assistant$/)).not.toBeInTheDocument();
    const completedThoughtToggle = screen.getByRole("button", { name: /^已完成$/ });
    expect(completedThoughtToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("思考")).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking through the answer.")).not.toBeInTheDocument();
    fireEvent.click(completedThoughtToggle);
    expect(screen.getByText("Thinking through the answer.")).toBeInTheDocument();
    expect(screen.queryByText(/assistant-turn-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Streaming…/)).not.toBeInTheDocument();
    expect(screen.getByTestId("session-event-log")).toHaveClass("browser-acp-transcript-scroll");

    await openDebugPanel();

    const runtimeLogs = screen.getByLabelText("Runtime logs") as HTMLTextAreaElement;
    expect(runtimeLogs.value).toContain("Current Session Events");
    expect(runtimeLogs.value).toContain("\"type\": \"session.started\"");
    expect(runtimeLogs.value).toContain("\"updateKind\": \"available_commands_update\"");
    expect(runtimeLogs.value).toContain("\"chunk\": \"Thinking through the answer.\"");
    expect(runtimeLogs.value).toContain("\"chunk\": \"Clean assistant reply\"");
  });

  it("shows a collapsed running thought row with a loading indicator", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-thinking",
            prompt: "Think first",
            startedAt: "2026-04-08T03:51:30.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.delta",
            sessionId,
            turnId: "turn-thinking",
            chunk: "Still considering options.",
            role: "system",
            updateKind: "agent_thought_chunk",
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("Think first")).toBeInTheDocument();
    const runningThoughtToggle = screen.getByRole("button", { name: /^思考中$/ });
    expect(runningThoughtToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Thought loading")).toBeInTheDocument();
    expect(screen.queryByText("思考")).not.toBeInTheDocument();
    expect(screen.queryByText("Still considering options.")).not.toBeInTheDocument();
    fireEvent.click(runningThoughtToggle);
    expect(screen.getByText("Still considering options.")).toBeInTheDocument();
  });

  it("renders tool calls and permission requests as dedicated system rows", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-tools",
            prompt: "Inspect package metadata",
            startedAt: "2026-04-08T07:20:00.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "tool.call",
            sessionId,
            turnId: "turn-tools",
            createdAt: "2026-04-08T07:20:01.000Z",
            toolCall: {
              toolCallId: "tool-1",
              title: "Read package.json",
              kind: "read",
              status: "pending",
              rawInput: {
                path: "package.json",
              },
            },
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "permission.requested",
            sessionId,
            turnId: "turn-tools",
            permissionId: "permission-1",
            createdAt: "2026-04-08T07:20:02.000Z",
            toolCall: {
              toolCallId: "tool-1",
              title: "Read package.json",
              kind: "read",
              status: "pending",
              rawInput: {
                path: "package.json",
              },
            },
            options: [
              {
                optionId: "allow-once",
                kind: "allow_once",
                name: "Allow once",
              },
            ],
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "permission.resolved",
            sessionId,
            turnId: "turn-tools",
            permissionId: "permission-1",
            createdAt: "2026-04-08T07:20:03.000Z",
            toolCallId: "tool-1",
            outcome: "selected",
            selectedOption: {
              optionId: "allow-once",
              kind: "allow_once",
              name: "Allow once",
            },
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "tool.call.update",
            sessionId,
            turnId: "turn-tools",
            createdAt: "2026-04-08T07:20:04.000Z",
            toolCall: {
              toolCallId: "tool-1",
              status: "completed",
              rawOutput: {
                name: "browser_acp",
              },
            },
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.delta",
            sessionId,
            turnId: "turn-tools",
            chunk: "The package is named browser_acp.",
            role: "agent",
            updateKind: "agent_message_chunk",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "turn.completed",
            sessionId,
            turnId: "turn-tools",
            stopReason: "end_turn",
            completedAt: "2026-04-08T07:20:05.000Z",
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("Inspect package metadata")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          Boolean(
            node?.classList.contains("browser-acp-system-row-summary") &&
              (node.textContent?.includes("工具调用：read package.json") ?? false),
          ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          Boolean(
            node?.classList.contains("browser-acp-system-row-summary") &&
              (node.textContent?.includes("权限请求：read package.json") ?? false),
          ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("已允许")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /工具结果/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /请求输入/ })).not.toBeInTheDocument();
    expect(screen.queryByText("可选策略：")).not.toBeInTheDocument();
    expect(screen.queryByText(/最终选择：/)).not.toBeInTheDocument();
    expect(screen.getByText("The package is named browser_acp.")).toBeInTheDocument();
    expect(screen.getByTestId("session-event-log").lastElementChild).toHaveClass("browser-acp-transcript-end-spacer");
  });

  it("keeps tool call details collapsed by default and expands them on click", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-collapsible-tool",
            prompt: "Inspect file",
            startedAt: "2026-04-10T10:00:00.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "tool.call",
            sessionId,
            turnId: "turn-collapsible-tool",
            createdAt: "2026-04-10T10:00:01.000Z",
            toolCall: {
              toolCallId: "tool-collapse-1",
              title: "Read package.json",
              kind: "read",
              status: "pending",
              rawInput: {
                path: "package.json",
              },
            },
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "tool.call.update",
            sessionId,
            turnId: "turn-collapsible-tool",
            createdAt: "2026-04-10T10:00:02.000Z",
            toolCall: {
              toolCallId: "tool-collapse-1",
              status: "completed",
              rawOutput: {
                name: "browser_acp",
              },
            },
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    const toolSummary = await screen.findByText(
      (_, node) =>
        Boolean(
          node?.classList.contains("browser-acp-system-row-summary") &&
            (node.textContent?.includes("工具调用：read package.json") ?? false),
        ),
    );
    const toggle = toolSummary.closest("button");

    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /工具结果/ })).not.toBeInTheDocument();
    expect(screen.queryByText("输出：")).not.toBeInTheDocument();

    fireEvent.click(toggle!);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("输出：")).toBeInTheDocument();
    const hasToolPayload = (_: string, node: Element | null) =>
      Boolean(
        node?.tagName.toLowerCase() === "code" &&
          (node.textContent?.includes('"name": "browser_acp"') ?? false),
      );

    expect(screen.getByText(hasToolPayload)).toBeInTheDocument();
  });

  it("keeps permission request details collapsed by default and expands them on click", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-collapsible-permission",
            prompt: "Open desktop note",
            startedAt: "2026-04-10T11:00:00.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "permission.requested",
            sessionId,
            turnId: "turn-collapsible-permission",
            permissionId: "permission-collapse-1",
            createdAt: "2026-04-10T11:00:01.000Z",
            toolCall: {
              toolCallId: "tool-read-desktop-note",
              title: "Read ~/Desktop/notes.txt",
              kind: "read",
              status: "pending",
              rawInput: {
                path: "~/Desktop/notes.txt",
              },
            },
            options: [
              {
                optionId: "allow-once",
                kind: "allow_once",
                name: "Allow once",
              },
            ],
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    const permissionSummary = await screen.findByText(
        (_, node) =>
          Boolean(
            node?.classList.contains("browser-acp-system-row-summary") &&
              (node.textContent?.includes("权限请求：read ~/Desktop/notes.txt") ?? false),
          ),
    );
    const toggle = permissionSummary.closest("button");

    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /请求输入/ })).not.toBeInTheDocument();
    expect(screen.queryByText("请求输入：")).not.toBeInTheDocument();

    fireEvent.click(toggle!);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("请求输入：")).toBeInTheDocument();
    const hasPermissionPayload = (_: string, node: Element | null) =>
      Boolean(
        node?.tagName.toLowerCase() === "code" &&
          (node.textContent?.includes('"path": "~/Desktop/notes.txt"') ?? false),
      );

    expect(screen.getByText(hasPermissionPayload)).toBeInTheDocument();
  });

  it("sends a permission decision when the user approves a pending request", async () => {
    const resolvePermission = vi.fn();
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-permission",
            prompt: "Read local file",
            startedAt: "2026-04-10T08:10:00.000Z",
          },
        } satisfies SessionSocketServerMessage);
        onMessage({
          type: "event",
          event: {
            type: "permission.requested",
            sessionId,
            turnId: "turn-permission",
            permissionId: "permission-approve",
            createdAt: "2026-04-10T08:10:01.000Z",
            toolCall: {
              toolCallId: "tool-read-file",
              title: "Read ~/Desktop/notes.txt",
              kind: "read",
              status: "pending",
              rawInput: {
                path: "~/Desktop/notes.txt",
              },
            },
            options: [
              {
                optionId: "allow-once",
                kind: "allow_once",
                name: "Allow once",
              },
              {
                optionId: "reject-once",
                kind: "reject_once",
                name: "Reject once",
              },
            ],
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission,
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("Read local file")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "允许本次" }));

    expect(resolvePermission).toHaveBeenCalledWith({
      permissionId: "permission-approve",
      outcome: "selected",
      optionId: "allow-once",
    });
  });

  it("starts a new session explicitly and sends with the Enter shortcut", async () => {
    const sendPrompt = vi.fn();
    const bridge = createBridge({
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-2",
        agentId: "gemini-cli",
        agentName: "Gemini CLI",
        title: "Fresh thread",
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, _onMessage, _onError, onStatus) => {
        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });

        return {
          sendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByText("Choose an agent and send your first prompt to start a reading session.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Start a fresh thread" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask the current page anything..."), {
      key: "Enter",
      code: "Enter",
      shiftKey: false,
      nativeEvent: {
        isComposing: false,
      },
    });

    await waitFor(() => {
      expect(bridge.createSession).toHaveBeenCalledWith(bootstrap, "gemini-cli", context);
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-2",
          text: "Start a fresh thread",
        } satisfies Partial<PromptEnvelope>),
      );
    });
  });

  it("shows only one assistant card while a turn is running", async () => {
    const bridge = createBridge({
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        onStatus?.("open", { sessionId });
        onMessage({
          type: "event",
          event: {
            type: "turn.started",
            sessionId,
            turnId: "turn-running",
            prompt: "Still there?",
            startedAt: "2026-04-08T06:10:00.000Z",
          },
        } satisfies SessionSocketServerMessage);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByText("Still there?");
    expect(
      screen.getByTestId("session-event-log").querySelectorAll(".browser-acp-thread-message-assistant"),
    ).toHaveLength(1);
    expect(screen.queryByText("Streaming…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Assistant loading")).toBeInTheDocument();
  });

  it("clears the running state after a delayed turn.completed event arrives", async () => {
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-delayed-complete",
        agentId: "gemini-cli",
        agentName: "Gemini CLI",
        title: "Delayed complete thread",
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, onMessage, _onError, onStatus) => {
        setTimeout(() => {
          onStatus?.("open", { sessionId });
          onMessage({
            type: "event",
            event: {
              type: "turn.delta",
              sessionId,
              turnId: null,
              chunk: "",
              role: "system",
              updateKind: "available_commands_update",
            },
          } satisfies SessionSocketServerMessage);
          onMessage({
            type: "event",
            event: {
              type: "session.started",
              sessionId,
              summary: {
                ...sessions[0],
                id: sessionId,
                title: "Reading: Example post",
              },
            },
          } satisfies SessionSocketServerMessage);
          onMessage({
            type: "event",
            event: {
              type: "context.attached",
              sessionId,
              turnId: "turn-delayed-complete",
              context,
            },
          } satisfies SessionSocketServerMessage);
          onMessage({
            type: "event",
            event: {
              type: "turn.started",
              sessionId,
              turnId: "turn-delayed-complete",
              prompt: "hello",
              startedAt: "2026-04-08T06:37:21.396Z",
            },
          } satisfies SessionSocketServerMessage);
          onMessage({
            type: "event",
            event: {
              type: "turn.delta",
              sessionId,
              turnId: "turn-delayed-complete",
              chunk: "Hello",
              role: "agent",
              updateKind: "agent_message_chunk",
              contentType: "text",
            },
          } satisfies SessionSocketServerMessage);
          onMessage({
            type: "event",
            event: {
              type: "turn.delta",
              sessionId,
              turnId: "turn-delayed-complete",
              chunk: " world",
              role: "agent",
              updateKind: "agent_message_chunk",
              contentType: "text",
            },
          } satisfies SessionSocketServerMessage);
        }, 0);

        setTimeout(() => {
          onMessage({
            type: "event",
            event: {
              type: "turn.completed",
              sessionId,
              turnId: "turn-delayed-complete",
              stopReason: "end_turn",
              completedAt: "2026-04-08T06:37:27.523Z",
            },
          } satisfies SessionSocketServerMessage);
        }, 10);

        return {
          sendPrompt: vi.fn(),
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
      expect(screen.getByText("Hello world")).toBeInTheDocument();
      expect(screen.queryByText("Streaming…")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Assistant loading")).not.toBeInTheDocument();
    });
  });

  it("refreshes the active context right before sending a prompt", async () => {
    const sendPrompt = vi.fn();
    const getActiveContext = vi
      .fn()
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce(refreshedContext);
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      getActiveContext,
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-fresh-context",
        agentId: "gemini-cli",
        agentName: "Gemini CLI",
        title: "Fresh context thread",
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, _onMessage, _onError, onStatus) => {
        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });

        return {
          sendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    await openDebugPanel();
    expect(screen.getByText("Important sentence")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ask the current page anything..."), {
      target: { value: "Use the newest page context" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(bridge.createSession).toHaveBeenCalledWith(bootstrap, "gemini-cli", refreshedContext);
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Use the newest page context",
          context: refreshedContext,
        } satisfies Partial<PromptEnvelope>),
      );
    });

    expect(screen.getByText("Fresh selection")).toBeInTheDocument();
    expect(screen.getAllByText("Other page").length).toBeGreaterThan(0);
    expect(screen.getByText("https://example.com/other")).toBeInTheDocument();
  });

  it("updates the visible context when the background publishes a newer active tab context", async () => {
    type ContextSubscription = (onContext: (context: BrowserContextBundle) => void) => () => void;

    const bridge = createBridge() as BrowserAcpBridge & {
      subscribeToActiveContext?: ContextSubscription;
    };
    bridge.subscribeToActiveContext = vi.fn((onContext) => {
      queueMicrotask(() => {
        onContext(refreshedContext);
      });
      return vi.fn();
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });
    expect(bridge.subscribeToActiveContext).toHaveBeenCalledTimes(1);
    await openDebugPanel();

    await waitFor(() => {
      expect(screen.getByText("Fresh selection")).toBeInTheDocument();
      expect(screen.getAllByText("Other page").length).toBeGreaterThan(0);
      expect(screen.queryByText("Important sentence")).not.toBeInTheDocument();
    });
  });

  it("claims a pending selection action during bootstrap and sends it through the current session", async () => {
    const sendPrompt = vi.fn();
    const bridge = createBridge({
      claimPendingSelectionAction: vi.fn().mockResolvedValue({
        id: "action-1",
        action: "explain",
        selectionText: "Beta",
        promptText: "请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\nBeta",
        createdAt: "2026-04-08T13:20:00.000Z",
      }),
      connectSession: vi.fn().mockImplementation(() => ({
        sendPrompt,
        resolvePermission: vi.fn(),
        close: vi.fn(),
      })),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });

    await waitFor(() => {
      expect(bridge.claimPendingSelectionAction).toHaveBeenCalled();
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          text: "请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\nBeta",
        } satisfies Partial<PromptEnvelope>),
      );
      expect(bridge.createSession).not.toHaveBeenCalled();
    });
  });

  it("reconnects a closed session websocket before dispatching a claimed selection action", async () => {
    const firstSendPrompt = vi.fn();
    const secondSendPrompt = vi.fn();
    let connectCount = 0;
    let notifySelectionAction: (() => void) | undefined;

    const bridge = createBridge({
      claimPendingSelectionAction: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "action-reconnect",
          action: "search",
          selectionText: "Beta",
          promptText: "请搜索下面这段内容相关的背景资料，并结合当前页面总结关键信息：\n\nBeta",
          createdAt: "2026-04-10T07:40:00.000Z",
        }),
      subscribeToSelectionActions: vi.fn((onReady) => {
        notifySelectionAction = onReady;
        return vi.fn();
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, _onMessage, _onError, onStatus) => {
        connectCount += 1;

        if (connectCount === 1) {
          queueMicrotask(() => {
            onStatus?.("open", { sessionId });
            onStatus?.("close", { sessionId, code: 1006, wasClean: false });
          });

          return {
            sendPrompt: firstSendPrompt,
            resolvePermission: vi.fn(),
            close: vi.fn(),
          } satisfies BrowserAcpSocket;
        }

        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });

        return {
          sendPrompt: secondSendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });

    await waitFor(() => {
      expect(bridge.claimPendingSelectionAction).toHaveBeenCalledTimes(1);
      expect(bridge.connectSession).toHaveBeenCalledTimes(1);
    });

    expect(notifySelectionAction).toBeTypeOf("function");
    notifySelectionAction?.();

    await waitFor(() => {
      expect(bridge.connectSession).toHaveBeenCalledTimes(2);
      expect(secondSendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          text: "请搜索下面这段内容相关的背景资料，并结合当前页面总结关键信息：\n\nBeta",
        } satisfies Partial<PromptEnvelope>),
      );
    });

    expect(firstSendPrompt).not.toHaveBeenCalled();
  });

  it("creates a new session for a claimed selection action when no session exists", async () => {
    const sendPrompt = vi.fn();
    const bridge = createBridge({
      listSessions: vi.fn().mockResolvedValue([]),
      claimPendingSelectionAction: vi.fn().mockResolvedValue({
        id: "action-2",
        action: "examples",
        selectionText: "Beta",
        promptText: "请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\nBeta",
        createdAt: "2026-04-08T13:21:00.000Z",
      }),
      createSession: vi.fn().mockResolvedValue({
        ...sessions[0],
        id: "session-selection-action",
        title: "Selection action thread",
      }),
      connectSession: vi.fn().mockImplementation((_, sessionId, _onMessage, _onError, onStatus) => {
        queueMicrotask(() => {
          onStatus?.("open", { sessionId });
        });
        return {
          sendPrompt,
          resolvePermission: vi.fn(),
          close: vi.fn(),
        } satisfies BrowserAcpSocket;
      }),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    await screen.findByRole("button", { name: "Gemini CLI ready" });

    await waitFor(() => {
      expect(bridge.createSession).toHaveBeenCalledWith(bootstrap, "gemini-cli", context);
      expect(sendPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-selection-action",
          text: "请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\nBeta",
        } satisfies Partial<PromptEnvelope>),
      );
    });
  });

  it("keeps the shell visible when bootstrap fails", async () => {
    const bridge = createBridge({
      ensureDaemon: vi.fn().mockRejectedValue(new Error("Native host is not installed.")),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByText("新对话")).toBeInTheDocument();
    expect(await screen.findByText("Native host is not installed.")).toBeInTheDocument();
    expect(screen.getByText("No agents detected yet.")).toBeInTheDocument();
  });

  it("shows one unified debug panel for page details, selected text, and runtime logs", async () => {
    const bridge = createBridge({
      getDebugState: vi.fn().mockResolvedValue(debugState),
    });

    render(<BrowserAcpPanel bridge={bridge} />);

    expect(await screen.findByRole("switch", { name: "Debug" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Runtime logs")).not.toBeInTheDocument();

    await openDebugPanel();

    expect(screen.getByText("Current Page")).toBeInTheDocument();
    expect(screen.getByText("Selected Text")).toBeInTheDocument();
    expect(screen.getByText("Runtime Logs")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/post")).toBeInTheDocument();
    expect(screen.getByText("Important sentence")).toBeInTheDocument();

    const runtimeLogs = screen.getByLabelText("Runtime logs") as HTMLTextAreaElement;
    expect(runtimeLogs.value).toContain("panel bootstrap started");
    expect(runtimeLogs.value).toContain("ensureDaemon succeeded");
    expect(runtimeLogs.value).toContain("runtime session spawn started");
    expect(runtimeLogs.value).toContain("com.browser_acp.host");
  });
});

async function openDebugPanel() {
  const debugSwitch = await screen.findByRole("switch", { name: "Debug" });
  if (!(debugSwitch as HTMLInputElement).checked) {
    fireEvent.click(debugSwitch);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createBridge(overrides: Partial<BrowserAcpBridge> = {}): BrowserAcpBridge {
  return {
    ensureDaemon: vi.fn().mockResolvedValue(bootstrap),
    listAgents: vi.fn().mockResolvedValue(agents),
    listAgentSpecs: vi.fn().mockResolvedValue(agentSpecs),
    listAgentSpecCandidates: vi.fn().mockResolvedValue([]),
    createAgentSpec: vi.fn(),
    updateAgentSpec: vi.fn(),
    deleteAgentSpec: vi.fn(),
    listSessions: vi.fn().mockResolvedValue(sessions),
    getActiveContext: vi.fn().mockResolvedValue(context),
    subscribeToActiveContext: vi.fn().mockReturnValue(vi.fn()),
    claimPendingSelectionAction: vi.fn().mockResolvedValue(null),
    subscribeToSelectionActions: vi.fn().mockReturnValue(vi.fn()),
    getDebugState: vi.fn().mockResolvedValue(debugState),
    createSession: vi.fn().mockResolvedValue(sessions[0]),
    connectSession: vi.fn().mockImplementation(() => ({
      sendPrompt: vi.fn(),
      resolvePermission: vi.fn(),
      close: vi.fn(),
    })),
    ...overrides,
  };
}
