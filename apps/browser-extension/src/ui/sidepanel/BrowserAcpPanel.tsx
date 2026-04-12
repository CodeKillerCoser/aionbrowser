import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserContextBundle,
  ConversationSummary,
  DebugLogEntry,
  PermissionDecision,
  PromptEnvelope,
  SessionEvent,
} from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../messages";
import { MarkdownMessage } from "../../sidepanel/MarkdownMessage";
import type { BrowserAcpBridge, BrowserAcpSocket } from "../../sidepanel/contracts";
import {
  buildThreadMessages,
  type TranscriptItem,
  type TranscriptMessageItem,
  type TranscriptPermissionItem,
  type TranscriptToolItem,
} from "../../sidepanel/threadMessages";
import claudeIcon from "../../sidepanel/agent-icons/claude.svg";
import codexIcon from "../../sidepanel/agent-icons/codex.svg";
import geminiIcon from "../../sidepanel/agent-icons/gemini.svg";
import githubCopilotIcon from "../../sidepanel/agent-icons/github-copilot.svg";
import qoderIcon from "../../sidepanel/agent-icons/qoder.svg";
import { usePanelBootstrap } from "./hooks/usePanelBootstrap";

export type { BrowserAcpBridge, BrowserAcpSocket } from "../../sidepanel/contracts";

type NonThoughtSystemItem = TranscriptToolItem | TranscriptPermissionItem;

const AGENT_ICON_MAP: Record<string, string> = {
  "claude-agent": claudeIcon,
  "codex-cli": codexIcon,
  "gemini-cli": geminiIcon,
  "github-copilot-cli": githubCopilotIcon,
  "qoder-cli": qoderIcon,
};

function keepNewerContext(
  current: BrowserContextBundle | null,
  next: BrowserContextBundle,
): BrowserContextBundle {
  if (!current) {
    return next;
  }

  return Date.parse(next.capturedAt) >= Date.parse(current.capturedAt) ? next : current;
}

export function BrowserAcpPanel({ bridge }: { bridge: BrowserAcpBridge }) {
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [panelLogs, setPanelLogs] = useState<DebugLogEntry[]>([]);
  const [eventsBySession, setEventsBySession] = useState<Record<string, SessionEvent[]>>({});
  const [draft, setDraft] = useState("");
  const socketRef = useRef<BrowserAcpSocket | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingPromptRef = useRef<PromptEnvelope | null>(null);
  const pendingPermissionDecisionsRef = useRef<PermissionDecision[]>([]);
  const socketStatusRef = useRef<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const selectionActionInFlightRef = useRef(false);
  const lastSelectionActionSignalRef = useRef(0);
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const [selectionActionSignal, setSelectionActionSignal] = useState(1);
  const [socketReconnectVersion, setSocketReconnectVersion] = useState(0);
  const [submittingPermissionIds, setSubmittingPermissionIds] = useState<string[]>([]);
  const recordPanelLog = (message: string, details?: unknown, scope = "panel") => {
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      scope,
      message,
      details: details === undefined ? undefined : details,
    };

    setPanelLogs((current) => [...current, entry].slice(-80));
  };
  const {
    bootstrap,
    agents,
    sessions,
    context,
    selectedAgentId,
    selectedSessionId,
    error,
    debugState,
    setContext,
    setSessions,
    setSelectedAgentId,
    setSelectedSessionId,
    setError,
    setDebugState,
  } = usePanelBootstrap(bridge, recordPanelLog);

  useEffect(() => {
    const unsubscribe = bridge.subscribeToActiveContext((nextContext) => {
      setContext((current) => keepNewerContext(current, nextContext));
      recordPanelLog("active context synchronized", {
        tabId: nextContext.tabId,
        title: nextContext.title,
        url: nextContext.url,
        selectionLength: nextContext.selectionText.length,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [bridge, setContext]);

  useEffect(() => {
    const unsubscribe = bridge.subscribeToSelectionActions(() => {
      setSelectionActionSignal((current) => current + 1);
      recordPanelLog("selection action notification received");
    });

    return () => {
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bootstrap || !selectedSessionId) {
      socketRef.current = null;
      socketStatusRef.current = "idle";
      return;
    }

    recordPanelLog("session websocket connecting", {
      sessionId: selectedSessionId,
      port: bootstrap.port,
    });
    socketRef.current?.close();
    socketStatusRef.current = "connecting";
    let activeSocket: BrowserAcpSocket | null = null;
    const socket = bridge.connectSession(
      bootstrap,
      selectedSessionId,
      (message) => {
        if (message.type === "error") {
          recordPanelLog("session websocket error payload received", {
            sessionId: selectedSessionId,
            error: message.error,
          });
          setError(message.error ?? "Unknown session error.");
          return;
        }

        if (message.event) {
          const nextEvent = message.event;
          recordPanelLog("session event received", {
            sessionId: selectedSessionId,
            eventType: nextEvent.type,
          });
          setEventsBySession((current) => ({
            ...current,
            [selectedSessionId]: [...(current[selectedSessionId] ?? []), nextEvent],
          }));
        }
      },
      (socketError) => {
        recordPanelLog("session websocket failed", {
          sessionId: selectedSessionId,
          error: socketError,
        });
        setError(socketError);
      },
      (status, details) => {
        if (socketRef.current === activeSocket) {
          if (status === "open") {
            socketStatusRef.current = "open";
          } else if (status === "close") {
            socketStatusRef.current = "closed";
            socketRef.current = null;
          } else if (status === "error") {
            socketStatusRef.current = "error";
            socketRef.current = null;
          }
        }
        recordPanelLog(`session websocket ${status}`, {
          sessionId: selectedSessionId,
          ...details,
        });
        if (status === "open" && pendingPromptRef.current?.sessionId === selectedSessionId) {
          const pendingPrompt = pendingPromptRef.current;
          pendingPromptRef.current = null;
          socketRef.current?.sendPrompt(pendingPrompt);
          recordPanelLog("pending prompt flushed after websocket open", {
            sessionId: selectedSessionId,
            textLength: pendingPrompt.text.length,
          });
        }
        if (status === "open" && pendingPermissionDecisionsRef.current.length > 0) {
          while (pendingPermissionDecisionsRef.current.length > 0) {
            const decision = pendingPermissionDecisionsRef.current.shift()!;
            socketRef.current?.resolvePermission(decision);
            recordPanelLog("pending permission decision flushed after websocket open", {
              sessionId: selectedSessionId,
              permissionId: decision.permissionId,
              outcome: decision.outcome,
              optionId: decision.optionId,
            });
          }
        }
      },
    );
    activeSocket = socket;
    socketRef.current = socket;

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        socketStatusRef.current = "closed";
      }
      socket.close();
    };
  }, [bridge, bootstrap, selectedSessionId, setError, socketReconnectVersion]);

  const currentEvents = useMemo(
    () => eventsBySession[selectedSessionId] ?? [],
    [eventsBySession, selectedSessionId],
  );
  const threadMessages = useMemo(
    () => buildThreadMessages(currentEvents),
    [currentEvents],
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const activeAgentId = selectedSession?.agentId ?? selectedAgentId;
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const hasRunningTurn = threadMessages.some(
    (message) => message.kind === "message" && message.role === "assistant" && message.status.type === "running",
  );
  const hasAgents = agents.length > 0;
  const hasSessions = sessions.length > 0;
  const hasTranscript = threadMessages.length > 0;
  const debugText = useMemo(
    () => formatDebugState(debugState, panelLogs, selectedSessionId, currentEvents),
    [currentEvents, debugState, panelLogs, selectedSessionId],
  );

  useEffect(() => {
    if (!bootstrap || !context || !activeAgentId) {
      return;
    }

    if (selectionActionSignal === 0 || lastSelectionActionSignalRef.current === selectionActionSignal) {
      return;
    }

    lastSelectionActionSignalRef.current = selectionActionSignal;

    void claimAndProcessSelectionAction();
  }, [activeAgentId, bootstrap, context, selectionActionSignal]);

  useEffect(() => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [threadMessages]);

  useEffect(() => {
    const resolvedPermissionIds = new Set(
      currentEvents
        .filter((event): event is Extract<SessionEvent, { type: "permission.resolved" }> => event.type === "permission.resolved")
        .map((event) => event.permissionId),
    );

    if (resolvedPermissionIds.size === 0) {
      return;
    }

    setSubmittingPermissionIds((current) => current.filter((permissionId) => !resolvedPermissionIds.has(permissionId)));
  }, [currentEvents]);

  useEffect(() => {
    const input = composerInputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "0px";

    const computedStyle = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
    const verticalInset = input.offsetHeight - input.clientHeight;
    const minHeight = lineHeight + verticalInset;
    const maxHeight = lineHeight * 10 + verticalInset;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight));

    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  async function handleSendPrompt(promptText: string): Promise<boolean> {
    if (!bootstrap || !context || !activeAgentId || promptText.trim().length === 0) {
      recordPanelLog("send prompt ignored because required state is missing", {
        hasBootstrap: Boolean(bootstrap),
        hasContext: Boolean(context),
        selectedAgentId: activeAgentId,
        draftLength: promptText.trim().length,
      });
      return false;
    }

    let activeContext = context;

    try {
      activeContext = await bridge.getActiveContext();
      setContext((current) => keepNewerContext(current, activeContext));
      recordPanelLog("active context refreshed before send", {
        tabId: activeContext.tabId,
        title: activeContext.title,
        url: activeContext.url,
        selectionLength: activeContext.selectionText.length,
      });
    } catch (contextError) {
      recordPanelLog("active context refresh failed before send", {
        error: contextError instanceof Error ? contextError.message : String(contextError),
      });
    }

    let sessionId = selectedSessionId;
    const promptEnvelope: PromptEnvelope = {
      sessionId: sessionId || "pending-session",
      agentId: activeAgentId,
      text: promptText,
      context: activeContext,
    };

    try {
      if (!sessionId) {
        recordPanelLog("create session requested", {
          agentId: activeAgentId,
          pageTitle: activeContext.title,
        });
        const summary = await bridge.createSession(bootstrap, activeAgentId, activeContext);
        setSessions((current) => [summary, ...current.filter((entry) => entry.id !== summary.id)]);
        setSelectedSessionId(summary.id);
        setSelectedAgentId(summary.agentId);
        setError(null);
        sessionId = summary.id;
        recordPanelLog("create session completed", {
          sessionId: summary.id,
          agentId: summary.agentId,
        });
        pendingPromptRef.current = {
          ...promptEnvelope,
          sessionId: summary.id,
        };
        recordPanelLog("prompt queued until websocket opens", {
          sessionId: summary.id,
          agentId: selectedAgentId,
          textLength: promptText.length,
        });
        return true;
      }

      if (!socketRef.current || socketStatusRef.current === "closed" || socketStatusRef.current === "error") {
        pendingPromptRef.current = {
          ...promptEnvelope,
          sessionId,
        };
        setSocketReconnectVersion((current) => current + 1);
        recordPanelLog("prompt queued while websocket reconnects", {
          sessionId,
          agentId: activeAgentId,
          textLength: promptText.length,
        });
        return true;
      }

      recordPanelLog("prompt dispatched from panel", {
        sessionId,
        agentId: activeAgentId,
        textLength: promptText.length,
      });
      socketRef.current.sendPrompt({
        ...promptEnvelope,
        sessionId,
      });
      setError(null);
      return true;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      setError(message);
      recordPanelLog("send prompt failed", {
        error: message,
        sessionId,
        agentId: activeAgentId,
      });
      try {
        const nextDebugState = await bridge.getDebugState();
        setDebugState(nextDebugState);
      } catch {
        // Ignore diagnostics refresh failures.
      }
      return false;
    }
  }

  function handleResolvePermission(item: TranscriptPermissionItem, decision: PermissionDecision): void {
    if (!bootstrap || !selectedSessionId) {
      recordPanelLog("permission decision ignored because session state is missing", {
        hasBootstrap: Boolean(bootstrap),
        sessionId: selectedSessionId,
        permissionId: decision.permissionId,
      });
      return;
    }

    setSubmittingPermissionIds((current) =>
      current.includes(item.permissionId) ? current : [...current, item.permissionId],
    );

    if (!socketRef.current || socketStatusRef.current === "closed" || socketStatusRef.current === "error") {
      pendingPermissionDecisionsRef.current.push(decision);
      setSocketReconnectVersion((current) => current + 1);
      recordPanelLog("permission decision queued while websocket reconnects", {
        sessionId: selectedSessionId,
        permissionId: decision.permissionId,
        outcome: decision.outcome,
        optionId: decision.optionId,
      });
      return;
    }

    socketRef.current.resolvePermission(decision);
    recordPanelLog("permission decision sent", {
      sessionId: selectedSessionId,
      permissionId: decision.permissionId,
      outcome: decision.outcome,
      optionId: decision.optionId,
    });
  }

  async function handleComposerSubmit() {
    const nextDraft = draft.trim();
    if (!nextDraft || hasRunningTurn) {
      return;
    }

    const didSend = await handleSendPrompt(nextDraft);
    if (didSend) {
      setDraft("");
    }
  }

  async function claimAndProcessSelectionAction(): Promise<void> {
    if (!bootstrap || !context || !activeAgentId || selectionActionInFlightRef.current) {
      return;
    }

    selectionActionInFlightRef.current = true;

    try {
      const action = await bridge.claimPendingSelectionAction();
      if (!action) {
        return;
      }

      recordPanelLog("selection action claimed", {
        actionId: action.id,
        action: action.action,
        selectionLength: action.selectionText.length,
        hasSelectedSession: Boolean(selectedSessionId),
      });

      const didSend = await handleSendPrompt(action.promptText);
      if (didSend) {
        recordPanelLog("selection action prompt dispatched", {
          actionId: action.id,
          action: action.action,
        });
      }
    } catch (selectionActionError) {
      const message =
        selectionActionError instanceof Error ? selectionActionError.message : String(selectionActionError);
      setError(message);
      recordPanelLog("selection action processing failed", {
        error: message,
      });
    } finally {
      selectionActionInFlightRef.current = false;
    }
  }

  async function handleRefreshDiagnostics() {
    try {
      recordPanelLog("diagnostics refresh requested");
      const nextDebugState = await bridge.getDebugState();
      setDebugState(nextDebugState);
      recordPanelLog("diagnostics refresh completed", {
        daemonLogCount: nextDebugState.daemonLogs.length,
        backgroundLogCount: nextDebugState.logs.length,
      });
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
      recordPanelLog("diagnostics refresh failed", {
        error: message,
      });
    }
  }

  function handleStartNewSession() {
    setSelectedSessionId("");
    setError(null);
    recordPanelLog("new session draft started", {
      selectedAgentId,
    });
  }

  const conversationTitle = selectedSession?.title ?? "新对话";
  const conversationAgentName = activeAgent?.name ?? "未选择智能体";

  return (
    <div className={`browser-acp-shell${isSidebarCollapsed ? " browser-acp-shell-collapsed" : ""}`}>
      <aside className={`browser-acp-sidebar${isSidebarCollapsed ? " browser-acp-sidebar-collapsed" : ""}`}>
        <section className="browser-acp-sidebar-topbar">
          {!isSidebarCollapsed ? <h2>Agents</h2> : null}
          <button
            type="button"
            className="browser-acp-sidebar-toggle"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
        </section>

        <section>
          <div className={`browser-acp-agent-bar${isSidebarCollapsed ? " browser-acp-agent-bar-collapsed" : ""}`}>
            {hasAgents ? (
              agents.map((agent) => {
                const localPath = getAgentLocalPath(agent);
                const iconSrc = AGENT_ICON_MAP[agent.id];

                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`browser-acp-agent-icon-button${
                      selectedAgentId === agent.id ? " browser-acp-agent-icon-button-active" : ""
                    }`}
                    aria-pressed={selectedAgentId === agent.id}
                    aria-label={`${agent.name} ${agent.status}`}
                    title={`${agent.name}\n${localPath}`}
                    onClick={() => {
                      setSelectedAgentId(agent.id);
                      setError(null);
                      if (selectedSession && selectedSession.agentId !== agent.id) {
                        setSelectedSessionId("");
                      }
                      recordPanelLog("agent selected", {
                        agentId: agent.id,
                        status: agent.status,
                      });
                    }}
                  >
                    {iconSrc ? (
                      <img className="browser-acp-agent-icon-image" src={iconSrc} alt="" aria-hidden="true" />
                    ) : (
                      <span className="browser-acp-agent-icon-fallback" aria-hidden="true">
                        {getAvatarLabel(agent.name)}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <p className="browser-acp-empty">No agents detected yet.</p>
            )}
          </div>
        </section>

        {!isSidebarCollapsed ? (
          <section className="browser-acp-sidebar-history">
            <div className="browser-acp-section-header browser-acp-section-header-history">
              <h2>对话历史</h2>
              <button type="button" className="browser-acp-secondary-button" onClick={handleStartNewSession}>
                新建
              </button>
            </div>
            <div className="browser-acp-session-list">
              {hasSessions ? (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="browser-acp-session-item"
                    aria-pressed={selectedSessionId === session.id}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setSelectedAgentId(session.agentId);
                      setError(null);
                      recordPanelLog("session selected", {
                        sessionId: session.id,
                        agentId: session.agentId,
                      });
                    }}
                  >
                    <span className="browser-acp-session-item-title">{session.title}</span>
                  </button>
                ))
              ) : (
                <p className="browser-acp-empty">No saved sessions yet.</p>
              )}
            </div>
          </section>
        ) : null}

      </aside>

      <main className="browser-acp-main">
        <header className="browser-acp-header">
          <div className="browser-acp-header-copy browser-acp-header-copy-conversation">
            <h1>{conversationTitle}</h1>
            <p>{conversationAgentName}</p>
          </div>
          <div className="browser-acp-header-meta">
            <label className="browser-acp-debug-toggle browser-acp-debug-toggle-inline">
              <span className="browser-acp-debug-toggle-label">Debug</span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Debug"
                checked={showDebugPanel}
                onChange={(event) => {
                  setShowDebugPanel(event.target.checked);
                  recordPanelLog("debug panel visibility changed", {
                    visible: event.target.checked,
                  });
                }}
              />
              <span className="browser-acp-debug-toggle-state">{showDebugPanel ? "On" : "Off"}</span>
            </label>
            {error ? <div className="browser-acp-error">{error}</div> : null}
          </div>
        </header>

        {showDebugPanel ? (
          <section className="browser-acp-debug-panel-shell">
            <div className="browser-acp-debug-panel">
              <section className="browser-acp-debug-group">
                <h3>Current Page</h3>
                <dl className="browser-acp-debug-meta">
                  <div className="browser-acp-debug-meta-row">
                    <dt>Title</dt>
                    <dd className="browser-acp-debug-value">{context?.title ?? "none"}</dd>
                  </div>
                  <div className="browser-acp-debug-meta-row">
                    <dt>Link</dt>
                    <dd className="browser-acp-debug-value">
                      {context?.url ? (
                        <a
                          className="browser-acp-debug-link"
                          href={context.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {context.url}
                        </a>
                      ) : (
                        "none"
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="browser-acp-debug-group">
                <h3>Selected Text</h3>
                <pre className="browser-acp-debug-selection">{context?.selectionText || "none"}</pre>
              </section>

              <section className="browser-acp-debug-group">
                <div className="browser-acp-debug-group-header">
                  <h3>Runtime Logs</h3>
                  <button
                    type="button"
                    className="browser-acp-secondary-button"
                    onClick={() => void handleRefreshDiagnostics()}
                  >
                    Refresh
                  </button>
                </div>
                <textarea
                  className="browser-acp-diagnostics"
                  readOnly
                  value={debugText}
                  aria-label="Runtime logs"
                />
              </section>
            </div>
          </section>
        ) : null}

        <div className={`browser-acp-transcript${hasTranscript ? "" : " browser-acp-transcript-empty"}`}>
          <div
            ref={transcriptViewportRef}
            className="browser-acp-transcript-scroll"
            data-testid="session-event-log"
          >
            {hasTranscript ? (
              threadMessages.map((message) =>
                message.kind === "message" ? (
                  <div
                    key={message.id}
                    className={`browser-acp-message browser-acp-thread-message browser-acp-thread-message-${message.role}`}
                    data-message-id={message.id}
                  >
                    <div className="browser-acp-thread-message-body">
                      {message.content.map((part, index) =>
                        part.type === "text" ? (
                          <MarkdownMessage
                            key={`${message.id}-part-${index}`}
                            tone={message.role === "user" ? "user" : "assistant"}
                          >
                            {part.text}
                          </MarkdownMessage>
                        ) : (
                          <pre key={`${message.id}-part-${index}`} className="browser-acp-thread-message-part-raw">
                            {JSON.stringify(part.value, null, 2)}
                          </pre>
                        ),
                      )}
                      {message.status.type === "running" ? (
                        <p className="browser-acp-thread-message-status">Streaming…</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <SystemEventRow
                    key={message.id}
                    item={message}
                    isSubmitting={submittingPermissionIds.includes(message.systemType === "permission" ? message.permissionId : "")}
                    onResolvePermission={handleResolvePermission}
                  />
                ),
              )
            ) : (
              <p className="browser-acp-empty browser-acp-empty-main">
                {selectedSessionId
                  ? "No messages have arrived in this session yet."
                  : "Choose an agent and send your first prompt to start a reading session."}
              </p>
            )}
            {hasTranscript ? <div className="browser-acp-transcript-end-spacer" aria-hidden="true" /> : null}
          </div>
        </div>

        <div className="browser-acp-composer">
          <div className="browser-acp-composer-surface">
            <textarea
              ref={composerInputRef}
              className="browser-acp-composer-input"
              placeholder="Ask the current page anything..."
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                const isComposing = "isComposing" in event.nativeEvent && event.nativeEvent.isComposing;
                if (event.key !== "Enter" || event.shiftKey || isComposing) {
                  return;
                }

                event.preventDefault();
                void handleComposerSubmit();
              }}
            />
            <div className="browser-acp-composer-footer">
              <span className="browser-acp-composer-hint">
                {hasRunningTurn ? "Assistant is responding…" : "Enter to send · Shift+Enter for a new line"}
              </span>
              <button
                type="button"
                className="browser-acp-composer-send"
                onClick={() => void handleComposerSubmit()}
                disabled={!draft.trim() || hasRunningTurn || !bootstrap || !context || !activeAgentId}
              >
                <span>Send</span>
                <span className="browser-acp-composer-shortcut" aria-hidden="true">
                  ↵
                </span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function getAvatarLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "A";
}

function getAgentLocalPath(agent: { detectedCommand?: string; launchCommand: string; launchArgs: string[] }): string {
  const command = agent.detectedCommand ?? agent.launchCommand;
  const suffix = agent.launchArgs.length > 0 ? ` ${agent.launchArgs.join(" ")}` : "";
  const label = command.startsWith("/") ? "Local path" : "Command";
  return `${label}: ${command}${suffix}`;
}

function SystemEventRow({
  item,
  isSubmitting,
  onResolvePermission,
}: {
  item: Exclude<TranscriptItem, TranscriptMessageItem>;
  isSubmitting: boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  if (item.systemType === "thought") {
    return null;
  }

  if (item.systemType === "permission") {
    return (
      <PermissionEventRow
        item={item}
        isSubmitting={isSubmitting}
        onResolvePermission={onResolvePermission}
      />
    );
  }

  if (item.systemType === "tool") {
    return <ToolEventRow item={item} />;
  }

  const header = getSystemEventHeader(item);
  const status = getSystemEventStatus(item);
  const detail = getSystemEventDetail(item);

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <SystemEventSummary header={header} status={status} />
      {detail ? (
        <div className="browser-acp-system-row-body">
          <MarkdownMessage>{detail.body}</MarkdownMessage>
        </div>
      ) : null}
    </div>
  );
}

function ToolEventRow({ item }: { item: TranscriptToolItem }) {
  const [expanded, setExpanded] = useState(false);
  const header = getSystemEventHeader(item);
  const status = getSystemEventStatus(item);
  const detail = getSystemEventDetail(item);
  const hasDetail = Boolean(detail?.body.trim());

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <SystemEventSummary
        header={header}
        status={status}
        expanded={hasDetail ? expanded : undefined}
        onToggle={hasDetail ? () => setExpanded((current) => !current) : undefined}
      />
      {expanded && detail ? (
        <div className="browser-acp-system-row-body">
          <MarkdownMessage>{detail.body}</MarkdownMessage>
        </div>
      ) : null}
    </div>
  );
}

function PermissionEventRow({
  item,
  isSubmitting,
  onResolvePermission,
}: {
  item: TranscriptPermissionItem;
  isSubmitting: boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const header = getSystemEventHeader(item);
  const status = getSystemEventStatus(item);
  const detail = getSystemEventDetail(item);
  const hasDetail = Boolean(detail?.body.trim());
  const canRespond = !item.outcome;

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <SystemEventSummary
        header={header}
        status={status}
        expanded={hasDetail ? expanded : undefined}
        onToggle={hasDetail ? () => setExpanded((current) => !current) : undefined}
      />
      {expanded && detail ? (
        <div className="browser-acp-system-row-body">
          <MarkdownMessage>{detail.body}</MarkdownMessage>
        </div>
      ) : null}
      {canRespond ? (
        <div className="browser-acp-permission-actions">
          {item.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              className={`browser-acp-permission-action browser-acp-permission-action-${getPermissionOptionTone(option.kind)}`}
              disabled={isSubmitting}
              onClick={() =>
                onResolvePermission(item, {
                  permissionId: item.permissionId,
                  outcome: "selected",
                  optionId: option.optionId,
                })
              }
            >
              {formatPermissionOptionLabel(option.kind, option.name)}
            </button>
          ))}
          <button
            type="button"
            className="browser-acp-permission-action browser-acp-permission-action-neutral"
            disabled={isSubmitting}
            onClick={() =>
              onResolvePermission(item, {
                permissionId: item.permissionId,
                outcome: "cancelled",
              })
            }
          >
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SystemEventSummary({
  header,
  status,
  expanded,
  onToggle,
}: {
  header: { label: string; title: string | null; command: string | null };
  status: { text: string; tone: "neutral" | "success" | "warning" | "danger" } | null;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isInteractive = typeof expanded === "boolean" && typeof onToggle === "function";

  const content = (
    <div className="browser-acp-system-row-header">
      <div className="browser-acp-system-row-copy">
        <p className="browser-acp-system-row-summary">
          <span className="browser-acp-system-row-summary-label">{header.label}：</span>
          {header.title ? <strong className="browser-acp-system-row-summary-title">{header.title}</strong> : null}
          {header.command ? (
            <>
              {header.title ? (
                <span className="browser-acp-system-row-summary-separator" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <code className="browser-acp-system-row-summary-command">{header.command}</code>
            </>
          ) : null}
        </p>
      </div>
      <div className="browser-acp-system-row-meta">
        {status ? (
          <span className={`browser-acp-system-row-status browser-acp-system-row-status-${status.tone}`}>{status.text}</span>
        ) : null}
        {isInteractive ? (
          <span
            className={`browser-acp-system-row-chevron${expanded ? " browser-acp-system-row-chevron-expanded" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        ) : null}
      </div>
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className="browser-acp-system-row-summary-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {content}
      </button>
    );
  }

  return content;
}

function getSystemEventHeader(item: NonThoughtSystemItem): { label: string; title: string | null; command: string | null } {
  const command = summarizeToolCommand(item.toolCall);
  const inputSummary = summarizeToolInput(item.toolCall.rawInput);
  const title = dedupeSystemEventTitle(item.toolCall.title, command, inputSummary);

  switch (item.systemType) {
    case "tool":
      return {
        label: "工具调用",
        title: title ?? (!command ? item.toolCall.title ?? "执行工具操作" : null),
        command,
      };
    case "permission":
      return {
        label: "权限请求",
        title: title ?? (!command ? item.toolCall.title ?? "请求执行权限" : null),
        command,
      };
  }
}

function getSystemEventStatus(
  item: NonThoughtSystemItem,
): { text: string; tone: "neutral" | "success" | "warning" | "danger" } | null {
  if (item.systemType === "tool") {
    const status = item.toolCall.status ?? "pending";
    return {
      text: formatToolStatus(status),
      tone:
        status === "completed"
          ? "success"
          : status === "failed"
            ? "danger"
            : status === "in_progress"
              ? "warning"
              : "neutral",
    };
  }

  if (!item.outcome) {
    return {
      text: "待你确认",
      tone: "warning",
    };
  }

  if (item.outcome === "cancelled") {
    return {
      text: "已取消",
      tone: "neutral",
    };
  }

  if (item.selectedOption?.kind.startsWith("reject")) {
    return {
      text: "已拒绝",
      tone: "danger",
    };
  }

  return {
    text: "已允许",
    tone: "success",
  };
}

function getSystemEventDetail(item: NonThoughtSystemItem): { label: string; body: string } | null {
  if (item.systemType === "tool") {
    return buildToolCallDetail(item);
  }

  return buildPermissionDetail(item);
}

function buildToolCallDetail(item: TranscriptToolItem): { label: string; body: string } | null {
  const resultSections: string[] = [];
  const contentSections = item.toolCall.content
    ?.map((content) => formatToolContentMarkdown(content))
    .filter(Boolean) as string[] | undefined;
  if (contentSections?.length) {
    resultSections.push(contentSections.join("\n\n"));
  }

  if (item.toolCall.rawOutput !== undefined) {
    resultSections.push(["输出：", "```json", safeJsonStringify(item.toolCall.rawOutput), "```"].join("\n"));
  }

  if (resultSections.length > 0) {
    return {
      label: "工具结果",
      body: resultSections.join("\n\n"),
    };
  }

  if (item.toolCall.rawInput !== undefined) {
    return {
      label: "调用参数",
      body: ["输入：", "```json", safeJsonStringify(item.toolCall.rawInput), "```"].join("\n"),
    };
  }

  if (item.toolCall.locations?.length) {
    return {
      label: "涉及文件",
      body: item.toolCall.locations.map((location) => `- \`${formatLocation(location.path, location.line)}\``).join("\n"),
    };
  }

  return null;
}

function buildPermissionDetail(item: TranscriptPermissionItem): { label: string; body: string } | null {
  if (item.toolCall.rawInput === undefined) {
    return null;
  }

  return {
    label: "请求输入",
    body: ["请求输入：", "```json", safeJsonStringify(item.toolCall.rawInput), "```"].join("\n"),
  };
}

function getPermissionOptionTone(kind: TranscriptPermissionItem["options"][number]["kind"]): "success" | "danger" | "neutral" {
  if (kind.startsWith("allow")) {
    return "success";
  }

  if (kind.startsWith("reject")) {
    return "danger";
  }

  return "neutral";
}

function formatPermissionOptionLabel(
  kind: TranscriptPermissionItem["options"][number]["kind"],
  fallbackName: string,
): string {
  switch (kind) {
    case "allow_once":
      return "允许本次";
    case "allow_always":
      return "始终允许";
    case "reject_once":
      return "拒绝本次";
    case "reject_always":
      return "始终拒绝";
    default:
      return fallbackName;
  }
}

function summarizeToolCommand(toolCall: TranscriptToolItem["toolCall"]): string | null {
  const inputSummary = summarizeToolInput(toolCall.rawInput);

  if (toolCall.kind && inputSummary) {
    return `${toolCall.kind} ${inputSummary}`;
  }

  if (inputSummary) {
    return inputSummary;
  }

  if (toolCall.kind) {
    return toolCall.kind;
  }

  return null;
}

function dedupeSystemEventTitle(
  title: string | null | undefined,
  command: string | null,
  inputSummary: string | null,
): string | null {
  if (!title) {
    return null;
  }

  const normalizedTitle = normalizeInlineComparison(title);
  if (!normalizedTitle) {
    return null;
  }

  if (command && normalizedTitle === normalizeInlineComparison(command)) {
    return null;
  }

  if (inputSummary && normalizedTitle === normalizeInlineComparison(inputSummary)) {
    return null;
  }

  return title;
}

function summarizeToolInput(rawInput: unknown): string | null {
  if (typeof rawInput === "string") {
    return truncateInline(rawInput, 72);
  }

  if (typeof rawInput === "number" || typeof rawInput === "boolean") {
    return String(rawInput);
  }

  if (Array.isArray(rawInput)) {
    const summary = rawInput
      .map((value) => summarizeToolInput(value))
      .filter((value): value is string => Boolean(value))
      .join(" ");

    return summary ? truncateInline(summary, 72) : null;
  }

  if (!rawInput || typeof rawInput !== "object") {
    return null;
  }

  const preferredKeys = ["command", "path", "filePath", "url", "query", "target", "name"] as const;
  const record = rawInput as Record<string, unknown>;

  for (const key of preferredKeys) {
    const value = record[key];
    const summary = summarizeToolInput(value);
    if (summary) {
      return summary;
    }
  }

  const compactEntries = Object.entries(record)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${summarizeToolInput(value) ?? truncateInline(safeJsonStringify(value), 28)}`)
    .join(" ");

  return compactEntries ? truncateInline(compactEntries, 72) : null;
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeInlineComparison(value: string): string {
  return value
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatToolContentMarkdown(content: TranscriptToolItem["toolCall"]["content"][number]): string {
  switch (content.type) {
    case "text":
      return content.text ? `结果：\n> ${content.text.replace(/\n/g, "\n> ")}` : "";
    case "diff":
      return [
        `变更文件：\`${content.path ?? "unknown"}\``,
        "```diff",
        buildDiffPreview(content.oldText ?? "", content.newText ?? ""),
        "```",
      ].join("\n");
    case "terminal":
      return `终端会话：\`${content.terminalId}\``;
    case "resource_link":
    case "resource":
      return [
        `资源：${content.title ?? content.name ?? content.uri ?? "unknown"}`,
        content.uri ? `[打开资源](${content.uri})` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "image":
      return `图片输出${content.mimeType ? `：\`${content.mimeType}\`` : ""}`;
    case "audio":
      return `音频输出${content.mimeType ? `：\`${content.mimeType}\`` : ""}`;
  }
}

function buildDiffPreview(oldText: string, newText: string): string {
  if (!oldText && newText) {
    return newText
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n");
  }

  return ["--- before", oldText, "+++ after", newText].join("\n");
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToolStatus(status: string): string {
  switch (status) {
    case "pending":
      return "等待执行";
    case "in_progress":
      return "执行中";
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    default:
      return status;
  }
}

function formatLocation(path: string, line?: number | null): string {
  return line ? `${path}:${line}` : path;
}

function formatDebugState(
  debugState: BackgroundDebugState | null,
  panelLogs: DebugLogEntry[],
  selectedSessionId: string,
  currentEvents: SessionEvent[],
): string {
  if (!debugState) {
    return "Diagnostics have not been loaded yet.";
  }

  const summary = {
    extensionId: debugState.extensionId,
    nativeHostName: debugState.nativeHostName,
    daemonBaseUrl: debugState.daemonBaseUrl,
    bootstrapCache: debugState.bootstrapCache,
    daemonStatus: debugState.daemonStatus,
  };

  const logText = debugState.logs
    .map((entry) => {
      const details = entry.details === undefined ? "" : ` ${JSON.stringify(entry.details)}`;
      return `${entry.timestamp} [${entry.scope}] ${entry.message}${details}`;
    })
    .join("\n");
  const daemonLogText = debugState.daemonLogs
    .map((entry) => {
      const details = entry.details === undefined ? "" : ` ${JSON.stringify(entry.details)}`;
      return `${entry.timestamp} [${entry.scope}] ${entry.message}${details}`;
    })
    .join("\n");
  const panelLogText = panelLogs
    .map((entry) => {
      const details = entry.details === undefined ? "" : ` ${JSON.stringify(entry.details)}`;
      return `${entry.timestamp} [${entry.scope}] ${entry.message}${details}`;
    })
    .join("\n");
  const rawSessionEventsText = currentEvents
    .map((event, index) => `#${index + 1}\n${JSON.stringify(event, null, 2)}`)
    .join("\n\n");

  return [
    `Summary: ${JSON.stringify(summary, null, 2)}`,
    "",
    "Logs:",
    logText || "No logs yet.",
    "",
    "Panel Logs:",
    panelLogText || "No panel logs yet.",
    "",
    "Daemon Logs:",
    daemonLogText || "No daemon logs yet.",
    "",
    `Current Session Events${selectedSessionId ? ` (${selectedSessionId})` : ""}:`,
    rawSessionEventsText || "No session events yet.",
  ].join("\n");
}
