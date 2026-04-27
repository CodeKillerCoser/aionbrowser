import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationSummary,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
import {
  PENDING_SESSION_ID,
  buildThreadMessages,
  appendSessionEvent,
  findActiveAgent,
  findSelectedSession,
  formatAgentLocalPath,
  getConversationAgentName,
  getConversationTitle,
  getSessionEvents,
  hasRunningAssistantTurn,
  markPermissionSubmitting,
  mergeOptimisticPrompts,
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
          if (selectedSession && selectedSession.agentId !== agent.id) {
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
          <ConversationDebugPanel
            contextHeading="Current Page"
            contextTitle={context?.title}
            contextUrl={context?.url}
            selectedText={context?.selectionText}
            diagnosticsText={debugText}
            onRefreshDiagnostics={() => void refreshDiagnostics()}
          />
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
          placeholder="询问当前页面，或直接输入任务..."
          onChange={setDraft}
          onSubmit={() => void handleComposerSubmit()}
        />
      </main>
    </div>
  );
}
