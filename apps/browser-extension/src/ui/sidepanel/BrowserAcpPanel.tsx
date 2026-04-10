import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserContextBundle,
  ConversationSummary,
  DebugLogEntry,
  PromptEnvelope,
  SessionEvent,
} from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../messages";
import { MarkdownMessage } from "../../sidepanel/MarkdownMessage";
import type { BrowserAcpBridge, BrowserAcpSocket } from "../../sidepanel/contracts";
import { buildThreadMessages } from "../../sidepanel/threadMessages";
import { usePanelBootstrap } from "./hooks/usePanelBootstrap";

export type { BrowserAcpBridge, BrowserAcpSocket } from "../../sidepanel/contracts";

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
  const [panelLogs, setPanelLogs] = useState<DebugLogEntry[]>([]);
  const [eventsBySession, setEventsBySession] = useState<Record<string, SessionEvent[]>>({});
  const [draft, setDraft] = useState("");
  const socketRef = useRef<BrowserAcpSocket | null>(null);
  const pendingPromptRef = useRef<PromptEnvelope | null>(null);
  const selectionActionInFlightRef = useRef(false);
  const lastSelectionActionSignalRef = useRef(0);
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const [selectionActionSignal, setSelectionActionSignal] = useState(1);
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
      return;
    }

    recordPanelLog("session websocket connecting", {
      sessionId: selectedSessionId,
      port: bootstrap.port,
    });
    socketRef.current?.close();
    socketRef.current = bridge.connectSession(
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
      },
    );

    return () => {
      socketRef.current?.close();
    };
  }, [bridge, bootstrap, selectedSessionId, setError]);

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
  const hasRunningTurn = threadMessages.some(
    (message) => message.role === "assistant" && message.status?.type === "running",
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

      if (!socketRef.current) {
        pendingPromptRef.current = {
          ...promptEnvelope,
          sessionId,
        };
        recordPanelLog("prompt queued until websocket connection is ready", {
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

  return (
    <div className="browser-acp-shell">
      <aside className="browser-acp-sidebar">
        <section>
          <h2>Agents</h2>
          <div className="browser-acp-list">
            {hasAgents ? (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="browser-acp-item"
                  aria-pressed={selectedAgentId === agent.id}
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
                  <span>{agent.name}</span>
                  <small>{agent.status}</small>
                </button>
              ))
            ) : (
              <p className="browser-acp-empty">No agents detected yet.</p>
            )}
          </div>
        </section>
        <section>
          <div className="browser-acp-section-header">
            <h2>Sessions</h2>
            <button type="button" className="browser-acp-secondary-button" onClick={handleStartNewSession}>
              New
            </button>
          </div>
          <div className="browser-acp-list">
            {hasSessions ? (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="browser-acp-item"
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
                  <span>{session.title}</span>
                  <small>{session.pageTitle}</small>
                </button>
              ))
            ) : (
              <p className="browser-acp-empty">No saved sessions yet.</p>
            )}
          </div>
        </section>
        <section>
          <div className="browser-acp-section-header">
            <h2>Debug</h2>
            <label className="browser-acp-debug-toggle">
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
          </div>

          {showDebugPanel ? (
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
          ) : null}
        </section>
      </aside>

      <main className="browser-acp-main">
        <header className="browser-acp-header">
          <div>
            <h1>Browser ACP</h1>
            <p>{selectedSession?.title ?? "Read the current page with any connected agent."}</p>
          </div>
          {error ? <div className="browser-acp-error">{error}</div> : null}
        </header>

        <div className={`browser-acp-transcript${hasTranscript ? "" : " browser-acp-transcript-empty"}`}>
          <div
            ref={transcriptViewportRef}
            className="browser-acp-transcript-scroll"
            data-testid="session-event-log"
          >
            {hasTranscript ? (
              threadMessages.map((message) => (
                <div
                  key={message.id}
                  className={`browser-acp-message browser-acp-thread-message browser-acp-thread-message-${message.role}`}
                  data-message-id={message.id}
                >
                  <div className="browser-acp-thread-message-header">
                    <strong>{message.role === "assistant" ? "Assistant" : "You"}</strong>
                  </div>
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
                          {JSON.stringify(part, null, 2)}
                        </pre>
                      ),
                    )}
                    {message.status?.type === "running" ? (
                      <p className="browser-acp-thread-message-status">Streaming…</p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="browser-acp-empty browser-acp-empty-main">
                {selectedSessionId
                  ? "No messages have arrived in this session yet."
                  : "Choose an agent and send your first prompt to start a reading session."}
              </p>
            )}
          </div>
        </div>

        <div className="browser-acp-composer">
          <textarea
            className="browser-acp-composer-input"
            placeholder="Ask the current page anything..."
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
          <button
            type="button"
            className="browser-acp-composer-send"
            onClick={() => void handleComposerSubmit()}
            disabled={!draft.trim() || hasRunningTurn || !bootstrap || !context || !activeAgentId}
          >
            Send
          </button>
        </div>
      </main>
    </div>
  );
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
