import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationSummary,
  ModelState,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
import {
  PENDING_SESSION_ID,
  buildThreadMessages,
  appendSessionEvent,
  createModelCache,
  findActiveAgent,
  findSelectedSession,
  formatAgentLocalPath,
  getConversationAgentName,
  getConversationTitle,
  getSessionEvents,
  hasRunningAssistantTurn,
  markPermissionSubmitting,
  mergeOptimisticPrompts,
  MODEL_CACHE_TTL_MS,
  type OptimisticPrompt,
  type SessionSocketStatus,
} from "@browser-acp/client-core";
import {
  AgentSettingsPage,
  ConversationDebugPanel,
  ConversationHeader,
  ConversationSidebar,
  MessageComposer,
  TranscriptPane,
} from "@browser-acp/ui-react";
import type { BackgroundDebugState } from "../../messages";
import type { BrowserAcpBridge, BrowserAcpSocket } from "../../host-api/agentConsoleHost";
import { resolveAgentIcon } from "./agentIcons";
import { useActiveContextSubscription } from "./hooks/useActiveContextSubscription";
import { useAgentSettingsPanel } from "./hooks/useAgentSettingsPanel";
import { usePanelBootstrap } from "./hooks/usePanelBootstrap";
import { usePanelDiagnostics } from "./hooks/usePanelDiagnostics";
import { usePanelLog } from "./hooks/usePanelLog";
import { usePermissionResolver } from "./hooks/usePermissionResolver";
import { usePromptSender } from "./hooks/usePromptSender";
import { useScrollToLatestTranscriptItem } from "./hooks/useScrollToLatestTranscriptItem";
import { useSelectionActionProcessor } from "./hooks/useSelectionActionProcessor";
import { useSelectionActionSubscription } from "./hooks/useSelectionActionSubscription";
import { useSessionSocket } from "./hooks/useSessionSocket";
import { useTranscriptHousekeeping } from "./hooks/useTranscriptHousekeeping";

export type { BrowserAcpBridge, BrowserAcpSocket } from "../../host-api/agentConsoleHost";

const MODEL_REQUEST_TIMEOUT_MS =
  typeof process !== "undefined" && process.env.NODE_ENV === "test"
    ? 20
    : 20 * 1000;

interface ModelLoadEntry {
  promise: Promise<ModelState | null>;
  requestId: number;
}

export function BrowserAcpPanel({ bridge }: { bridge: BrowserAcpBridge }) {
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [eventsBySession, setEventsBySession] = useState<Record<string, SessionEvent[]>>({});
  const [draft, setDraft] = useState("");
  const socketRef = useRef<BrowserAcpSocket | null>(null);
  const pendingPromptRef = useRef<PromptEnvelope | null>(null);
  const pendingPermissionDecisionsRef = useRef<PermissionDecision[]>([]);
  const socketStatusRef = useRef<SessionSocketStatus>("idle");
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const [selectionActionSignal, setSelectionActionSignal] = useState(1);
  const [socketReconnectVersion, setSocketReconnectVersion] = useState(0);
  const [submittingPermissionIds, setSubmittingPermissionIds] = useState<string[]>([]);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [modelChanging, setModelChanging] = useState(false);
  const [modelLoadingAgentIds, setModelLoadingAgentIds] = useState<string[]>([]);
  const [modelCacheVersion, setModelCacheVersion] = useState(0);
  const modelCacheRef = useRef(createModelCache());
  const modelLoadPromisesRef = useRef(new Map<string, ModelLoadEntry>());
  const modelLoadTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const modelLoadRequestIdRef = useRef(0);
  const modelCacheRefreshTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const modelWarmupRunRef = useRef(0);
  const selectedAgentIdRef = useRef("");
  const selectedSessionIdRef = useRef("");
  const { panelLogs, recordPanelLog } = usePanelLog();
  const {
    hostReady,
    agents,
    agentSpecs,
    sessions,
    context,
    selectedAgentId,
    selectedSessionId,
    error,
    debugState,
    setContext,
    setSessions,
    setAgents,
    setAgentSpecs,
    setSelectedAgentId,
    setSelectedSessionId,
    setError,
    setDebugState,
  } = usePanelBootstrap(bridge, recordPanelLog);

  selectedAgentIdRef.current = selectedAgentId;
  selectedSessionIdRef.current = selectedSessionId;
  const agentSettingsPanel = useAgentSettingsPanel({
    bridge,
    visible: showAgentSettings,
    hostReady,
    agentSpecs,
    setAgentSpecs,
    setAgents,
    setSelectedAgentId,
    setError,
    recordPanelLog,
  });

  useActiveContextSubscription({
    bridge,
    setContext,
    recordPanelLog,
  });

  const signalSelectionAction = useCallback(() => {
    setSelectionActionSignal((current) => current + 1);
  }, []);

  useSelectionActionSubscription({
    bridge,
    onSignal: signalSelectionAction,
    recordPanelLog,
  });

  const appendSessionSocketEvent = useCallback((sessionId: string, event: SessionEvent) => {
    setEventsBySession((current) => appendSessionEvent(current, sessionId, event));
  }, []);

  useSessionSocket({
    bridge,
    hostReady,
    selectedSessionId,
    socketReconnectVersion,
    socketRef,
    socketStatusRef,
    pendingPromptRef,
    pendingPermissionDecisionsRef,
    appendEvent: appendSessionSocketEvent,
    setError,
    recordPanelLog,
  });

  const currentEvents = useMemo(
    () => getSessionEvents(eventsBySession, selectedSessionId),
    [eventsBySession, selectedSessionId],
  );
  const baseThreadMessages = useMemo(
    () => buildThreadMessages(currentEvents),
    [currentEvents],
  );
  const threadMessages = useMemo(
    () => mergeOptimisticPrompts(baseThreadMessages, optimisticPrompts, selectedSessionId || PENDING_SESSION_ID),
    [baseThreadMessages, optimisticPrompts, selectedSessionId],
  );
  const selectedSession = useMemo(
    () => findSelectedSession(sessions, selectedSessionId),
    [selectedSessionId, sessions],
  );
  const activeAgentId = selectedSession?.agentId ?? selectedAgentId;
  const activeModelState = useMemo(() => {
    return activeAgentId ? modelCacheRef.current.get(activeAgentId) : null;
  }, [activeAgentId, modelCacheVersion]);
  const activeModelLoading = Boolean(activeAgentId && modelLoadingAgentIds.includes(activeAgentId));
  const modelBusy = activeModelLoading || modelChanging;
  const activeAgent = useMemo(
    () => findActiveAgent(agents, selectedSession, selectedAgentId),
    [agents, selectedAgentId, selectedSession],
  );
  const hasRunningTurn = hasRunningAssistantTurn(threadMessages);
  const { debugText, refreshDiagnostics } = usePanelDiagnostics({
    bridge,
    debugState,
    panelLogs,
    selectedSessionId,
    currentEvents,
    setDebugState,
    setError,
    recordPanelLog,
  });

  useScrollToLatestTranscriptItem(transcriptViewportRef, threadMessages);
  useTranscriptHousekeeping({
    currentEvents,
    selectedSessionId,
    setOptimisticPrompts,
    setSubmittingPermissionIds,
  });
  useEffect(() => {
    return () => {
      modelCacheRefreshTimersRef.current.forEach((timer) => clearTimeout(timer));
      modelCacheRefreshTimersRef.current.clear();
      modelLoadTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
      modelLoadTimeoutsRef.current.clear();
      modelLoadPromisesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!hostReady || !agents.length) {
      return;
    }

    const runId = modelWarmupRunRef.current + 1;
    modelWarmupRunRef.current = runId;
    const orderedAgentIds = [
      ...(activeAgentId ? [activeAgentId] : []),
      ...agents.map((agent) => agent.id).filter((agentId) => agentId !== activeAgentId),
    ];

    void (async () => {
      for (const agentId of orderedAgentIds) {
        if (modelWarmupRunRef.current !== runId) {
          return;
        }

        if (modelCacheRef.current.has(agentId)) {
          continue;
        }

        const isActiveAgent = agentId === activeAgentId;
        try {
          if (isActiveAgent && selectedSessionId) {
            await loadModelsForSession(selectedSessionId, agentId, {
              logSource: "auto",
              showEmptyError: false,
            });
          } else {
            await loadAgentModelState(agentId, () => bridge.getAgentModels(agentId), {
              logSource: isActiveAgent ? "auto" : "background",
              showEmptyError: false,
            });
          }
        } catch {
          // Background warmup failures are already recorded by the loader.
        }
      }
    })();
  }, [activeAgentId, agents, hostReady, selectedSessionId]);

  const { sendPrompt } = usePromptSender({
    bridge,
    hostReady,
    context,
    activeAgentId,
    selectedAgentId,
    selectedSessionId,
    socketRef,
    socketStatusRef,
    pendingPromptRef,
    setSocketReconnectVersion,
    setContext,
    setOptimisticPrompts,
    setSessions,
    setSelectedSessionId,
    setSelectedAgentId,
    setError,
    setDebugState,
    recordPanelLog,
  });

  useSelectionActionProcessor({
    bridge,
    selectionActionSignal,
    hostReady,
    context,
    activeAgentId,
    selectedSessionId,
    sendPrompt,
    setError,
    recordPanelLog,
  });

  const { resolvePermissionDecision } = usePermissionResolver({
    hostReady,
    selectedSessionId,
    socketRef,
    socketStatusRef,
    pendingPermissionDecisionsRef,
    markPermissionSubmitting: (permissionId) => {
      setSubmittingPermissionIds((current) => markPermissionSubmitting(current, permissionId));
    },
    setSocketReconnectVersion,
    recordPanelLog,
  });

  async function handleComposerSubmit() {
    const nextDraft = draft.trim();
    if (!nextDraft || hasRunningTurn) {
      return;
    }

    setDraft("");
    await sendPrompt(nextDraft);
  }

  function handleStartNewSession() {
    setSelectedSessionId("");
    setError(null);
    recordPanelLog("new session draft started", {
      selectedAgentId,
    });
  }

  async function handleRenameSession(session: ConversationSummary, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    setError(null);
    try {
      const updatedSession = await bridge.renameSession(session.id, nextTitle);
      setSessions((current) => current.map((entry) => entry.id === updatedSession.id ? updatedSession : entry));
      recordPanelLog("session renamed", {
        sessionId: updatedSession.id,
        title: updatedSession.title,
      });
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
      throw renameError;
    }
  }

  async function handleDeleteSession(session: ConversationSummary) {
    setError(null);
    try {
      await bridge.deleteSession(session.id);
      setSessions((current) => current.filter((entry) => entry.id !== session.id));
      setEventsBySession((current) => {
        const { [session.id]: _removed, ...rest } = current;
        return rest;
      });
      setOptimisticPrompts((current) => current.filter((entry) => entry.sessionId !== session.id));

      if (selectedSessionIdRef.current === session.id) {
        socketRef.current?.close();
        socketRef.current = null;
        setSelectedSessionId("");
        setSelectedAgentId(session.agentId);
        setSubmittingPermissionIds([]);
      }

      recordPanelLog("session deleted", {
        sessionId: session.id,
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      throw deleteError;
    }
  }

  async function handleModelChange(modelId: string) {
    if (!selectedSessionId || !activeAgentId || modelBusy) {
      return;
    }

    setModelChanging(true);
    setError(null);
    try {
      const models = await bridge.setSessionModel(selectedSessionId, modelId);
      rememberModels(activeAgentId, models);
      recordPanelLog("session model changed", {
        sessionId: selectedSessionId,
        modelId,
      });
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : String(changeError));
    } finally {
      setModelChanging(false);
    }
  }

  function markAgentModelLoading(agentId: string, loading: boolean): void {
    setModelLoadingAgentIds((current) => {
      if (loading) {
        return current.includes(agentId) ? current : [...current, agentId];
      }

      return current.filter((id) => id !== agentId);
    });
  }

  async function loadAgentModelState(
    agentId: string,
    requestModels: () => Promise<ModelState | null>,
    {
      logSource,
      showEmptyError,
    }: {
      logSource: "auto" | "manual" | "background";
      showEmptyError: boolean;
    },
  ): Promise<ModelState | null> {
    if (modelCacheRef.current.has(agentId)) {
      const cached = modelCacheRef.current.get(agentId);
      if (showEmptyError && !cached?.availableModels.length) {
        setError("当前 Agent 没有返回可切换的模型列表。");
      }
      return cached;
    }

    const pending = modelLoadPromisesRef.current.get(agentId);
    if (pending) {
      recordPanelLog("model list load joined", {
        source: logSource,
        agentId,
      });
      return pending.promise;
    }

    const requestId = modelLoadRequestIdRef.current + 1;
    modelLoadRequestIdRef.current = requestId;
    markAgentModelLoading(agentId, true);
    const timeout = setTimeout(() => {
      if (modelLoadPromisesRef.current.get(agentId)?.requestId !== requestId) {
        return;
      }

      modelLoadPromisesRef.current.delete(agentId);
      modelLoadTimeoutsRef.current.delete(agentId);
      markAgentModelLoading(agentId, false);
      recordPanelLog("model list load timed out", {
        source: logSource,
        agentId,
        timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
      });
    }, MODEL_REQUEST_TIMEOUT_MS);
    modelLoadTimeoutsRef.current.set(agentId, timeout);

    const promise = (async () => {
      try {
        const models = await requestModels();
        const isCurrentRequest = modelLoadPromisesRef.current.get(agentId)?.requestId === requestId;
        if (isCurrentRequest || !modelCacheRef.current.has(agentId)) {
          rememberModels(agentId, models);
        } else {
          recordPanelLog("stale model list load ignored", {
            source: logSource,
            agentId,
            requestId,
          });
        }
        if (showEmptyError && isCurrentRequest && !models?.availableModels.length) {
          setError("当前 Agent 没有返回可切换的模型列表。");
        }
        recordPanelLog("agent model list loaded", {
          source: logSource,
          agentId,
          modelCount: models?.availableModels.length ?? 0,
        });
        return models;
      } catch (modelError) {
        const isCurrentRequest = modelLoadPromisesRef.current.get(agentId)?.requestId === requestId;
        if (showEmptyError && isCurrentRequest) {
          setError(modelError instanceof Error ? modelError.message : String(modelError));
        }
        recordPanelLog("model list load failed", {
          source: logSource,
          agentId,
          error: modelError instanceof Error ? modelError.message : String(modelError),
        });
        throw modelError;
      } finally {
        if (modelLoadPromisesRef.current.get(agentId)?.requestId === requestId) {
          const pendingTimeout = modelLoadTimeoutsRef.current.get(agentId);
          if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            modelLoadTimeoutsRef.current.delete(agentId);
          }
          modelLoadPromisesRef.current.delete(agentId);
          markAgentModelLoading(agentId, false);
        }
      }
    })();

    modelLoadPromisesRef.current.set(agentId, {
      promise,
      requestId,
    });
    return promise;
  }

  async function loadModelsForSession(
    sessionId: string,
    agentId: string,
    {
      logSource,
      showEmptyError,
    }: {
      logSource: "auto" | "manual" | "background";
      showEmptyError: boolean;
    },
  ) {
    if (showEmptyError) {
      setError(null);
    }

    try {
      const models = await loadAgentModelState(agentId, () => bridge.getSessionModels(sessionId), {
        logSource,
        showEmptyError,
      });
      recordPanelLog("model list loaded", {
        source: logSource,
        sessionId,
        agentId,
        modelCount: models?.availableModels.length ?? 0,
      });
    } catch (modelError) {
      if (showEmptyError) {
        setError(modelError instanceof Error ? modelError.message : String(modelError));
      }
      recordPanelLog("model list load failed", {
        source: logSource,
        sessionId,
        agentId,
        error: modelError instanceof Error ? modelError.message : String(modelError),
      });
    }
  }

  async function prepareModelsForActiveAgent({
    logSource,
    showEmptyError,
  }: {
    logSource: "auto" | "manual";
    showEmptyError: boolean;
  }) {
    if (showEmptyError) {
      setError(null);
    }

    try {
      if (!activeAgentId) {
        return;
      }

      if (!selectedSessionId) {
        const models = await loadAgentModelState(activeAgentId, () => bridge.getAgentModels(activeAgentId), {
          logSource,
          showEmptyError,
        });
        if (logSource === "auto" && selectedAgentIdRef.current !== activeAgentId) {
          recordPanelLog("stale auto agent model probe ignored", {
            agentId: activeAgentId,
            selectedAgentId: selectedAgentIdRef.current,
          });
          return;
        }

        recordPanelLog("agent model list loaded", {
          source: logSource,
          agentId: activeAgentId,
          modelCount: models?.availableModels.length ?? 0,
        });
        return;
      }

      await loadModelsForSession(selectedSessionId, activeAgentId, {
        logSource,
        showEmptyError,
      });
      recordPanelLog("model list session prepared", {
        source: logSource,
        sessionId: selectedSessionId,
        agentId: activeAgentId,
      });
    } catch (modelError) {
      if (showEmptyError) {
        setError(modelError instanceof Error ? modelError.message : String(modelError));
      }
    }
  }

  async function handleRequestModels() {
    if (modelBusy) {
      return;
    }

    await prepareModelsForActiveAgent({
      logSource: "manual",
      showEmptyError: true,
    });
  }

  function rememberModels(agentId: string, models: ModelState | null): void {
    modelCacheRef.current.set(agentId, models);
    setModelCacheVersion((current) => current + 1);

    const existingTimer = modelCacheRefreshTimersRef.current.get(agentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      modelCacheRefreshTimersRef.current.delete(agentId);
    }

    const nextTimer = setTimeout(() => {
      modelCacheRefreshTimersRef.current.delete(agentId);
      modelCacheRef.current.delete(agentId);
      setModelCacheVersion((current) => current + 1);
    }, MODEL_CACHE_TTL_MS + 1);
    modelCacheRefreshTimersRef.current.set(agentId, nextTimer);
  }

  const conversationTitle = getConversationTitle(selectedSession);
  const conversationAgentName = getConversationAgentName(activeAgent);

  if (showAgentSettings) {
    return (
      <AgentSettingsPage
        {...agentSettingsPanel}
        onBack={() => setShowAgentSettings(false)}
      />
    );
  }

  return (
    <div className={`browser-acp-shell${isSidebarCollapsed ? " browser-acp-shell-collapsed" : ""}`}>
      <ConversationSidebar
        agents={agents}
        sessions={sessions}
        selectedAgentId={selectedAgentId}
        selectedSessionId={selectedSessionId}
        collapsed={isSidebarCollapsed}
        getAgentIconSrc={resolveAgentIcon}
        getAgentLocalPath={formatAgentLocalPath}
        onOpenSettings={() => setShowAgentSettings(true)}
        onSelectAgent={(agent) => {
          setSelectedAgentId(agent.id);
          setError(null);
          if (activeAgentId !== agent.id) {
            setSelectedSessionId("");
          }
          recordPanelLog("agent selected", {
            agentId: agent.id,
            status: agent.status,
          });
        }}
        onSelectSession={(session) => {
          setSelectedSessionId(session.id);
          setSelectedAgentId(session.agentId);
          setError(null);
          recordPanelLog("session selected", {
            sessionId: session.id,
            agentId: session.agentId,
          });
        }}
        onStartNewSession={handleStartNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
      />

      <main className="browser-acp-main">
        <ConversationHeader
          title={conversationTitle}
          subtitle={conversationAgentName}
          debugEnabled={showDebugPanel}
          error={error}
          onDebugChange={(visible) => {
            setShowDebugPanel(visible);
            recordPanelLog("debug panel visibility changed", {
              visible,
            });
          }}
        />

        {showDebugPanel ? (
          <aside className="browser-acp-debug-drawer" role="complementary" aria-label="调试面板">
            <ConversationDebugPanel
              contextHeading="Current Page"
              contextTitle={context?.title}
              contextUrl={context?.url}
              selectedText={context?.selectionText}
              diagnosticsText={debugText}
              contextHistory={debugState?.contextHistory ?? []}
              onRefreshDiagnostics={() => void refreshDiagnostics()}
            />
          </aside>
        ) : null}

        <TranscriptPane
          viewportRef={transcriptViewportRef}
          messages={threadMessages}
          emptyMessage={selectedSessionId ? "这条对话还没有消息。" : "选择一个 Agent，然后开始提问。"}
          isPermissionSubmitting={(item) => submittingPermissionIds.includes(item.permissionId)}
          onResolvePermission={(item, decision) => resolvePermissionDecision(item.permissionId, decision)}
        />

        <MessageComposer
          value={draft}
          disabled={hasRunningTurn || !hostReady || !context || !activeAgentId}
          isBusy={hasRunningTurn}
          models={activeModelState}
          modelBusy={modelBusy}
          canRequestModels={Boolean(hostReady && activeAgentId && (selectedSessionId || context))}
          placeholder="询问当前页面，或直接输入任务..."
          onChange={setDraft}
          onModelChange={(modelId) => void handleModelChange(modelId)}
          onRequestModels={() => void handleRequestModels()}
          onModelSelectorLog={(message, details) => recordPanelLog(message, details)}
          onSubmit={() => void handleComposerSubmit()}
        />
      </main>
    </div>
  );
}
