import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentIconSpec,
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextBundle,
  ConversationSummary,
  DebugLogEntry,
  PermissionDecision,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
  ToolCallContentSummary,
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

const PENDING_SESSION_ID = "pending-session";

interface OptimisticPrompt {
  id: string;
  sessionId: string;
  agentId: string;
  text: string;
  createdAt: Date;
  context?: BrowserContextBundle;
  failureMessage?: string;
}

const AGENT_ICON_MAP: Record<string, string> = {
  "claude-agent": claudeIcon,
  "codex-cli": codexIcon,
  "gemini-cli": geminiIcon,
  "github-copilot-cli": githubCopilotIcon,
  "qoder-cli": qoderIcon,
};

const AGENT_NAME_ICON_MATCHERS: Array<[RegExp, string]> = [
  [/github\s+copilot|copilot/i, githubCopilotIcon],
  [/claude/i, claudeIcon],
  [/codex/i, codexIcon],
  [/gemini/i, geminiIcon],
  [/qoder/i, qoderIcon],
];

const AGENT_COMMAND_ICON_MATCHERS: Array<[RegExp, string]> = [
  [/github-copilot|copilot/i, githubCopilotIcon],
  [/claude/i, claudeIcon],
  [/codex/i, codexIcon],
  [/gemini|npx\s+@google\/gemini-cli/i, geminiIcon],
  [/qoder/i, qoderIcon],
];

function resolveBuiltinAgentIcon(name: string, launchCommand?: string): string | undefined {
  const matchedName = AGENT_NAME_ICON_MATCHERS.find(([pattern]) => pattern.test(name));
  if (matchedName) {
    return matchedName[1];
  }

  const matchedCommand = AGENT_COMMAND_ICON_MATCHERS.find(([pattern]) => pattern.test(launchCommand ?? ""));
  return matchedCommand?.[1];
}

function resolveAgentIcon(agent: ResolvedAgent): string | undefined {
  return agent.icon ?? AGENT_ICON_MAP[agent.id] ?? resolveBuiltinAgentIcon(agent.name, agent.launchCommand);
}

function resolveSpecIcon(spec: AgentSpec): string | undefined {
  if (spec.icon?.value) {
    return spec.icon.value;
  }

  if (spec.kind === "external-acp") {
    return resolveBuiltinAgentIcon(spec.name, spec.launch.command);
  }

  return resolveBuiltinAgentIcon(spec.name);
}

function resolveCandidateIcon(candidate: AgentSpecCandidate): string | undefined {
  return (
    candidate.icon?.value ??
    AGENT_ICON_MAP[candidate.catalogId] ??
    resolveBuiltinAgentIcon(candidate.name, candidate.launchCommand)
  );
}

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
  const [showAgentSettings, setShowAgentSettings] = useState(false);
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
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [settingsName, setSettingsName] = useState("");
  const [settingsCommand, setSettingsCommand] = useState("");
  const [settingsArgs, setSettingsArgs] = useState("");
  const [settingsIconUrl, setSettingsIconUrl] = useState("");
  const [settingsUploadedIcon, setSettingsUploadedIcon] = useState<AgentIconSpec | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [candidateScanBusy, setCandidateScanBusy] = useState(false);
  const [agentSpecCandidates, setAgentSpecCandidates] = useState<AgentSpecCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());
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

  useEffect(() => {
    if (!showAgentSettings || !bootstrap) {
      return;
    }

    void refreshAgentSpecCandidates();
  }, [showAgentSettings, bootstrap?.port, bootstrap?.token]);

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
  const baseThreadMessages = useMemo(
    () => buildThreadMessages(currentEvents),
    [currentEvents],
  );
  const threadMessages = useMemo(
    () => mergeOptimisticPrompts(baseThreadMessages, optimisticPrompts, selectedSessionId || PENDING_SESSION_ID),
    [baseThreadMessages, optimisticPrompts, selectedSessionId],
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
    if (!selectedSessionId) {
      return;
    }

    const startedPrompts = new Set(
      currentEvents
        .filter(
          (event): event is Extract<SessionEvent, { type: "turn.started" }> =>
            event.type === "turn.started",
        )
        .map((event) => event.prompt.trim())
        .filter(Boolean),
    );

    if (startedPrompts.size === 0) {
      return;
    }

    setOptimisticPrompts((current) =>
      current.filter(
        (prompt) => prompt.sessionId !== selectedSessionId || !startedPrompts.has(prompt.text.trim()),
      ),
    );
  }, [currentEvents, selectedSessionId]);

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
    const trimmedPrompt = promptText.trim();

    if (!bootstrap || !context || !activeAgentId || trimmedPrompt.length === 0) {
      recordPanelLog("send prompt ignored because required state is missing", {
        hasBootstrap: Boolean(bootstrap),
        hasContext: Boolean(context),
        selectedAgentId: activeAgentId,
        draftLength: trimmedPrompt.length,
      });
      return false;
    }

    let activeContext = context;
    const optimisticPromptId = createOptimisticPromptId();
    const optimisticSessionId = selectedSessionId || PENDING_SESSION_ID;

    setOptimisticPrompts((current) => [
      ...current,
      {
        id: optimisticPromptId,
        sessionId: optimisticSessionId,
        agentId: activeAgentId,
        text: trimmedPrompt,
        createdAt: new Date(),
        context: activeContext,
      },
    ]);

    try {
      activeContext = await bridge.getActiveContext();
      setContext((current) => keepNewerContext(current, activeContext));
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPromptId ? { ...prompt, context: activeContext } : prompt,
        ),
      );
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
      text: trimmedPrompt,
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
        setOptimisticPrompts((current) =>
          current.map((prompt) =>
            prompt.id === optimisticPromptId ? { ...prompt, sessionId: summary.id } : prompt,
          ),
        );
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
          textLength: trimmedPrompt.length,
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
          textLength: trimmedPrompt.length,
        });
        return true;
      }

      recordPanelLog("prompt dispatched from panel", {
        sessionId,
        agentId: activeAgentId,
        textLength: trimmedPrompt.length,
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
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPromptId ? { ...prompt, failureMessage: message } : prompt,
        ),
      );
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
      return true;
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

    setDraft("");
    await handleSendPrompt(nextDraft);
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

  async function refreshAgentSpecCandidates() {
    if (!bootstrap) {
      return;
    }

    setCandidateScanBusy(true);
    try {
      const candidates = await bridge.listAgentSpecCandidates(bootstrap);
      setAgentSpecCandidates(candidates);
      setSelectedCandidateIds(new Set(candidates.filter((candidate) => candidate.recommended).map((candidate) => candidate.catalogId)));
      recordPanelLog("agent spec candidates scanned", {
        count: candidates.length,
      });
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      setError(message);
      recordPanelLog("agent spec candidate scan failed", {
        error: message,
      });
    } finally {
      setCandidateScanBusy(false);
    }
  }

  async function handleSaveAgentSpec() {
    if (!bootstrap || settingsBusy) {
      return;
    }

    const name = settingsName.trim();
    const launchCommand = settingsCommand.trim();
    if (!name || !launchCommand) {
      setError("Agent name and launch command are required.");
      return;
    }

    const icon =
      settingsUploadedIcon ??
      (settingsIconUrl.trim()
        ? {
            kind: "url" as const,
            value: settingsIconUrl.trim(),
          }
        : undefined);

    setSettingsBusy(true);
    try {
      const created = await bridge.createAgentSpec(bootstrap, {
        name,
        launchCommand,
        launchArgs: parseLaunchArgs(settingsArgs),
        icon,
      });
      const [nextSpecs, nextAgents] = await Promise.all([
        bridge.listAgentSpecs(bootstrap),
        bridge.listAgents(bootstrap),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      void refreshAgentSpecCandidates();
      setSelectedAgentId(created.id);
      setSettingsName("");
      setSettingsCommand("");
      setSettingsArgs("");
      setSettingsIconUrl("");
      setSettingsUploadedIcon(null);
      setError(null);
      recordPanelLog("external agent spec created", {
        agentId: created.id,
        name: created.name,
      });
    } catch (settingsError) {
      const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
      setError(message);
      recordPanelLog("external agent spec creation failed", {
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleDeleteAgentSpec(agentId: string) {
    if (!bootstrap || settingsBusy) {
      return;
    }

    setSettingsBusy(true);
    try {
      await bridge.deleteAgentSpec(bootstrap, agentId);
      const [nextSpecs, nextAgents] = await Promise.all([
        bridge.listAgentSpecs(bootstrap),
        bridge.listAgents(bootstrap),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      void refreshAgentSpecCandidates();
      if (selectedAgentId === agentId) {
        setSelectedAgentId(nextAgents[0]?.id ?? "");
      }
      recordPanelLog("external agent spec deleted", {
        agentId,
      });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
      setError(message);
      recordPanelLog("external agent spec deletion failed", {
        agentId,
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleIconUpload(file: File | undefined) {
    if (!file) {
      setSettingsUploadedIcon(null);
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setSettingsUploadedIcon({
      kind: "uploaded",
      value: dataUrl,
    });
    setSettingsIconUrl("");
  }

  async function handleAddSelectedCandidates() {
    if (!bootstrap || settingsBusy) {
      return;
    }

    const selectedCandidates = agentSpecCandidates.filter((candidate) => selectedCandidateIds.has(candidate.catalogId));
    if (selectedCandidates.length === 0) {
      return;
    }

    setSettingsBusy(true);
    try {
      const createdSpecs = [];
      for (const candidate of selectedCandidates) {
        createdSpecs.push(await bridge.createAgentSpec(bootstrap, {
          name: candidate.name,
          launchCommand: candidate.launchCommand,
          launchArgs: candidate.launchArgs,
          description: candidate.description,
          icon: candidate.icon,
        }));
      }
      const [nextSpecs, nextAgents, nextCandidates] = await Promise.all([
        bridge.listAgentSpecs(bootstrap),
        bridge.listAgents(bootstrap),
        bridge.listAgentSpecCandidates(bootstrap),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      setAgentSpecCandidates(nextCandidates);
      setSelectedCandidateIds(new Set(nextCandidates.filter((candidate) => candidate.recommended).map((candidate) => candidate.catalogId)));
      if (createdSpecs[0]) {
        setSelectedAgentId(createdSpecs[0].id);
      }
      setError(null);
      recordPanelLog("agent spec candidates added", {
        count: createdSpecs.length,
      });
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : String(addError);
      setError(message);
      recordPanelLog("agent spec candidate add failed", {
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  function handleToggleCandidate(candidateId: string, checked: boolean) {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
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

  if (showAgentSettings) {
    return (
      <div className="browser-acp-settings-page">
        <aside className="browser-acp-settings-nav" aria-label="Settings navigation">
          <button
            type="button"
            className="browser-acp-settings-back"
            aria-label="返回对话"
            onClick={() => setShowAgentSettings(false)}
          >
            <span aria-hidden="true">←</span>
            <span>返回对话</span>
          </button>
          <nav className="browser-acp-settings-nav-list">
            <button type="button" className="browser-acp-settings-nav-item browser-acp-settings-nav-item-active">
              <span aria-hidden="true">⌘</span>
              <span>Agent 配置</span>
            </button>
            <button type="button" className="browser-acp-settings-nav-item" disabled>
              <span aria-hidden="true">◌</span>
              <span>外观</span>
            </button>
            <button type="button" className="browser-acp-settings-nav-item" disabled>
              <span aria-hidden="true">⎇</span>
              <span>快捷操作</span>
            </button>
          </nav>
        </aside>

        <main className="browser-acp-settings-content">
          <section className="browser-acp-settings-panel" aria-label="Agent settings panel">
            <div className="browser-acp-settings-hero">
              <p>Agent Backend</p>
              <h1>Agent 配置</h1>
              <span>扫描本机可用的 ACP agent，确认后写入配置文件。</span>
            </div>

            <div className="browser-acp-settings-card browser-acp-settings-list">
              <div className="browser-acp-settings-list-header">
                <div>
                  <h3>检测到可添加的 Agent</h3>
                  <p>默认扫描常见 ACP 后端，图标使用内置资源兜底。</p>
                </div>
                <button
                  type="button"
                  className="browser-acp-secondary-button"
                  disabled={candidateScanBusy || settingsBusy}
                  onClick={() => void refreshAgentSpecCandidates()}
                >
                  {candidateScanBusy ? "扫描中" : "重新扫描"}
                </button>
              </div>
              {agentSpecCandidates.length > 0 ? (
                <>
                  {agentSpecCandidates.map((candidate) => (
                    <AgentSpecCandidateRow
                      key={candidate.catalogId}
                      candidate={candidate}
                      checked={selectedCandidateIds.has(candidate.catalogId)}
                      disabled={settingsBusy}
                      onToggle={handleToggleCandidate}
                    />
                  ))}
                  <button
                    type="button"
                    className="browser-acp-composer-send browser-acp-settings-add-candidates"
                    disabled={settingsBusy || selectedCandidateIds.size === 0}
                    onClick={() => void handleAddSelectedCandidates()}
                  >
                    添加选中的 Agent
                  </button>
                </>
              ) : (
                <p className="browser-acp-empty">
                  {candidateScanBusy ? "正在扫描本机可用 agent..." : "没有发现新的可添加 agent。"}
                </p>
              )}
            </div>

            <div className="browser-acp-settings-card">
              <div className="browser-acp-settings-section-header">
                <h3>手动添加</h3>
                <p>用于接入未被扫描规则覆盖的外部 ACP agent。</p>
              </div>
              <div className="browser-acp-settings-grid">
                <label className="browser-acp-settings-field">
                  <span>Agent name</span>
                  <input
                    value={settingsName}
                    onChange={(event) => setSettingsName(event.target.value)}
                    placeholder="My ACP Agent"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>Launch command</span>
                  <input
                    value={settingsCommand}
                    onChange={(event) => setSettingsCommand(event.target.value)}
                    placeholder="/usr/local/bin/my-agent"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>Launch arguments</span>
                  <input
                    value={settingsArgs}
                    onChange={(event) => setSettingsArgs(event.target.value)}
                    placeholder="--acp --profile dev"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>Icon URL</span>
                  <input
                    value={settingsIconUrl}
                    onChange={(event) => {
                      setSettingsIconUrl(event.target.value);
                      if (event.target.value.trim()) {
                        setSettingsUploadedIcon(null);
                      }
                    }}
                    placeholder="https://example.com/icon.svg"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>Upload icon</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => void handleIconUpload(event.target.files?.[0])}
                  />
                </label>
              </div>
              <div className="browser-acp-settings-actions">
                <button
                  type="button"
                  className="browser-acp-composer-send"
                  disabled={settingsBusy || !settingsName.trim() || !settingsCommand.trim()}
                  onClick={() => void handleSaveAgentSpec()}
                >
                  Save external agent
                </button>
              </div>
            </div>

            <div className="browser-acp-settings-card browser-acp-settings-list">
              <div className="browser-acp-settings-section-header">
                <h3>已配置</h3>
                <p>这里的配置会统一作为 ACP agent 暴露给对话层。</p>
              </div>
              {agentSpecs.length > 0 ? (
                agentSpecs.map((spec) => (
                  <ConfiguredAgentSpecRow
                    key={spec.id}
                    spec={spec}
                    disabled={settingsBusy}
                    onDelete={handleDeleteAgentSpec}
                  />
                ))
              ) : (
                <p className="browser-acp-empty">还没有配置外部 agent。</p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={`browser-acp-shell${isSidebarCollapsed ? " browser-acp-shell-collapsed" : ""}`}>
      <aside className={`browser-acp-sidebar${isSidebarCollapsed ? " browser-acp-sidebar-collapsed" : ""}`}>
        <section className="browser-acp-sidebar-topbar">
          {!isSidebarCollapsed ? <h2>Agents</h2> : null}
          {!isSidebarCollapsed ? (
            <button
              type="button"
              className="browser-acp-sidebar-action"
              aria-label="Agent settings"
              onClick={() => setShowAgentSettings((current) => !current)}
            >
              ⚙
            </button>
          ) : null}
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
                const iconSrc = resolveAgentIcon(agent);

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
                        <LoadingIndicator />
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
            <div
              className="browser-acp-composer-footer"
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  return;
                }

                event.preventDefault();
                composerInputRef.current?.focus();
              }}
            >
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

function mergeOptimisticPrompts(
  baseMessages: TranscriptItem[],
  optimisticPrompts: OptimisticPrompt[],
  activeSessionId: string,
): TranscriptItem[] {
  const existingUserTexts = new Set(
    baseMessages
      .filter((item): item is TranscriptMessageItem => item.kind === "message" && item.role === "user")
      .map((item) => item.content.map((part) => (part.type === "text" ? part.text : "")).join("").trim())
      .filter(Boolean),
  );
  const visibleOptimisticMessages = optimisticPrompts
    .filter((prompt) => prompt.sessionId === activeSessionId)
    .filter((prompt) => !existingUserTexts.has(prompt.text.trim()))
    .flatMap(optimisticPromptToMessages);

  if (visibleOptimisticMessages.length === 0) {
    return baseMessages;
  }

  return [...baseMessages, ...visibleOptimisticMessages];
}

function optimisticPromptToMessages(prompt: OptimisticPrompt): TranscriptMessageItem[] {
  const userMessage: TranscriptMessageItem = {
    kind: "message",
    id: prompt.id,
    role: "user",
    createdAt: prompt.createdAt,
    content: [{ type: "text", text: prompt.text }],
    status: { type: "complete", reason: "stop" },
    metadata: {
      turnId: prompt.id,
      context: prompt.context,
    },
  };

  if (!prompt.failureMessage) {
    return [
      userMessage,
      {
        kind: "message",
        id: `${prompt.id}-loading`,
        role: "assistant",
        createdAt: prompt.createdAt,
        content: [],
        status: {
          type: "running",
        },
        metadata: {
          turnId: prompt.id,
          context: prompt.context,
        },
      },
    ];
  }

  return [
    userMessage,
    {
      kind: "message",
      id: `${prompt.id}-failure`,
      role: "assistant",
      createdAt: new Date(),
      content: [{ type: "text", text: `发送失败：${prompt.failureMessage}` }],
      status: {
        type: "incomplete",
        reason: "error",
        error: prompt.failureMessage,
      },
      metadata: {
        turnId: prompt.id,
        context: prompt.context,
      },
    },
  ];
}

function LoadingIndicator() {
  return (
    <span className="browser-acp-loading-indicator" aria-label="Assistant loading" role="status">
      <span className="browser-acp-loading-dot" aria-hidden="true" />
    </span>
  );
}

function createOptimisticPromptId(): string {
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ConfiguredAgentSpecRow({
  spec,
  disabled,
  onDelete,
}: {
  spec: AgentSpec;
  disabled: boolean;
  onDelete: (agentId: string) => void;
}) {
  const command =
    spec.kind === "external-acp"
      ? [spec.launch.command, ...spec.launch.args].join(" ")
      : "Built-in agent";
  const iconSrc = resolveSpecIcon(spec);

  return (
    <div className="browser-acp-settings-agent-row">
      <div className="browser-acp-settings-agent-icon">
        {iconSrc ? (
          <img src={iconSrc} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{getAvatarLabel(spec.name)}</span>
        )}
      </div>
      <div className="browser-acp-settings-agent-copy">
        <strong>{spec.name}</strong>
        <code>{command}</code>
      </div>
      {spec.kind === "external-acp" ? (
        <button
          type="button"
          className="browser-acp-secondary-button"
          disabled={disabled}
          onClick={() => onDelete(spec.id)}
        >
          删除
        </button>
      ) : null}
    </div>
  );
}

function AgentSpecCandidateRow({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: AgentSpecCandidate;
  checked: boolean;
  disabled: boolean;
  onToggle: (candidateId: string, checked: boolean) => void;
}) {
  const command = [candidate.launchCommand, ...candidate.launchArgs].join(" ");
  const iconSrc = resolveCandidateIcon(candidate);

  return (
    <label className="browser-acp-settings-candidate-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(candidate.catalogId, event.target.checked)}
      />
      <span className="browser-acp-settings-agent-icon">
        {iconSrc ? (
          <img src={iconSrc} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{getAvatarLabel(candidate.name)}</span>
        )}
      </span>
      <span className="browser-acp-settings-agent-copy">
        <strong>
          {candidate.name}
          <em>{formatCandidateStatus(candidate.status)}</em>
        </strong>
        <code>{command}</code>
        {candidate.detectedCommandPath ? <small>{candidate.detectedCommandPath}</small> : null}
        {candidate.installationHint ? <small>{candidate.installationHint}</small> : null}
      </span>
    </label>
  );
}

function parseLaunchArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function formatCandidateStatus(status: AgentSpecCandidate["status"]): string {
  switch (status) {
    case "ready":
      return "已安装";
    case "launchable":
      return "可启动";
    case "needs_adapter":
      return "需适配器";
    case "unavailable":
      return "不可用";
    default:
      return status;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Icon upload did not produce a data URL."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Icon upload failed.")));
    reader.readAsDataURL(file);
  });
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

  return null;
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

function formatToolContentMarkdown(content: ToolCallContentSummary): string {
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
    default:
      return "";
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
