import {
  BROWSER_ACP_NATIVE_HOST_NAME,
  DAEMON_BASE_ORIGIN,
  EXTENSION_STORAGE_KEYS,
  createDaemonBaseUrl,
} from "@browser-acp/config";
import type {
  AgentSpec,
  AgentSpecCandidate,
  BrowserContextBundle,
  BrowserContextTimelineEntry,
  BrowserTabPreview,
  ConversationSummary,
  DebugLogEntry,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  ModelState,
  NativeHostBootstrapResponse,
  PageTaskTemplate,
  ResolvedAgent,
} from "@browser-acp/shared-types";
import { sanitizePageTaskTemplates } from "@browser-acp/client-core";
import type {
  BackgroundDebugLogEntry,
  BackgroundDebugState,
  BackgroundRequest,
  BackgroundRuntimeMessage,
  PendingSelectionAction,
  PageContextPayload,
  SelectionActionType,
} from "./messages";
import { createBackgroundRouter } from "./background/router";
import { resolveSelectionText } from "./contextState";
import { mergeFramePageContexts } from "./frameContext";
import { capturePageContextInPage } from "./pageCapture";
import { createPendingSelectionActionService } from "./session/pendingSelectionActionService";

const DEBUG_LOG_LIMIT = 120;
const CONTEXT_HISTORY_LIMIT = 60;

const contextByTabId = new Map<number, BrowserContextBundle>();
const contextHistory: BrowserContextTimelineEntry[] = [];
const debugLogs: BackgroundDebugLogEntry[] = [];
let bootstrapCache: NativeHostBootstrapResponse | null = null;
let bootstrapRequest: Promise<NativeHostBootstrapResponse> | null = null;
let debugLogsHydrated = false;
let contextHistoryHydrated = false;
let pendingSelectionAction: PendingSelectionAction | null = null;
const pendingSelectionActionService = createPendingSelectionActionService({
  getCurrentAction: () => pendingSelectionAction,
  setCurrentAction: (action) => {
    pendingSelectionAction = action;
  },
  openSidePanel: openNativeSidePanel,
  persist: persistPendingSelectionAction,
  load: loadPendingSelectionAction,
  clear: clearPendingSelectionAction,
  getActiveContext: async (selectionText) => {
    const context = await getActiveContext({ refresh: true });
    return {
      ...context,
      selectionText,
    };
  },
  listPageTaskTemplates,
  notifyReady: () =>
    notifyRuntime({
      type: "browser-acp/selection-action-ready",
    }),
  logQueuedAction: (action, selectionText, target) =>
    recordDebugLog("selection-action", "selection action queued", {
      action,
      selectionLength: selectionText.length,
      tabId: target.tabId,
      windowId: target.windowId,
    }),
});
const backgroundRouter = createBackgroundRouter({
  updateContextFromPage,
  ensureDaemon,
  listAgents: async () => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ResolvedAgent[]>(bootstrap, "/agents");
  },
  listAgentSpecs: async () => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<AgentSpec[]>(bootstrap, "/agent-specs");
  },
  listAgentSpecCandidates: async () => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<AgentSpecCandidate[]>(bootstrap, "/agent-spec-candidates");
  },
  createAgentSpec: async (input: ExternalAgentSpecInput) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<AgentSpec>(bootstrap, "/agent-specs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  },
  updateAgentSpec: async (id: string, patch: ExternalAgentSpecPatch) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<AgentSpec>(bootstrap, `/agent-specs/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });
  },
  deleteAgentSpec: async (id: string) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<{ ok: true }>(bootstrap, `/agent-specs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  listSessions: async () => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ConversationSummary[]>(bootstrap, "/sessions");
  },
  getActiveContext: () => getActiveContext({ refresh: true }),
  getDebugState,
  listPageTaskTemplates,
  updatePageTaskTemplates,
  listContextHistory,
  createSession: async (agentId, context) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ConversationSummary>(bootstrap, "/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        context,
      }),
    });
  },
  renameSession: async (sessionId, title) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ConversationSummary>(bootstrap, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
      }),
    });
  },
  deleteSession: async (sessionId) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<{ ok: true }>(bootstrap, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  },
  getAgentModels: async (agentId) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ModelState | null>(bootstrap, `/agents/${encodeURIComponent(agentId)}/model`);
  },
  getSessionModels: async (sessionId) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ModelState | null>(bootstrap, `/sessions/${encodeURIComponent(sessionId)}/model`);
  },
  setSessionModel: async (sessionId, modelId) => {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ModelState | null>(bootstrap, `/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        modelId,
      }),
    });
  },
  queueSelectionAction: (action, selectionText, target) =>
    pendingSelectionActionService.queue(action, selectionText, target),
  claimPendingSelectionAction: () => pendingSelectionActionService.claim(),
});
void hydrateDebugLogs();

chrome.tabs.onActivated.addListener((activeInfo) => {
  void publishActiveContextUpdate("tabs.onActivated", activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) {
    return;
  }

  if (
    changeInfo.status === undefined &&
    changeInfo.title === undefined &&
    changeInfo.url === undefined
  ) {
    return;
  }

  void publishActiveContextUpdate("tabs.onUpdated", tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  await openNativeSidePanel(tab.windowId);
  await recordDebugLog("background", "browser action clicked", {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  void recordDebugLog("background", "message received", {
    type: message.type,
    tabId: sender.tab?.id,
  });
  void handleMessage(message, sender)
    .then((result) => {
      void recordDebugLog("background", "message handled", {
        type: message.type,
      });
      sendResponse(result);
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void recordDebugLog("background", "message failed", {
        type: message.type,
        error: errorMessage,
      });
      sendResponse({ ok: false, error: errorMessage });
    });

  return true;
});

async function handleMessage(message: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  return backgroundRouter.handle(message, sender);
}

async function updateContextFromPage(
  payload: PageContextPayload,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: true }> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return { ok: true };
  }

  const openTabsPreview = await listOpenTabs();
  const existing = contextByTabId.get(tabId);
  contextByTabId.set(tabId, {
    tabId,
    url: sender.tab?.url ?? payload.url,
    title: payload.title || sender.tab?.title || sender.tab?.url || "Untitled page",
    selectionText: resolveSelectionText({
      previousSelectionText: existing?.selectionText ?? "",
      nextSelectionText: payload.selectionText,
      hasFocus: payload.hasFocus,
    }),
    summaryMarkdown: payload.summaryMarkdown,
    openTabsPreview,
    capturedAt: new Date().toISOString(),
  });
  await recordDebugLog("context", "page context updated", {
    tabId,
    title: payload.title,
    url: payload.url,
    selectionLength: payload.selectionText.length,
  });

  if (await isActiveTab(tabId)) {
    await publishActiveContextUpdate("page-context-update", tabId);
  }

  return { ok: true };
}

async function getActiveContext(options: { refresh?: boolean; record?: boolean } = {}): Promise<BrowserContextBundle> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const openTabsPreview = await listOpenTabs();
  const tabId = activeTab?.id ?? -1;
  const existing = tabId >= 0 ? contextByTabId.get(tabId) : undefined;
  const snapshot =
    options.refresh && activeTab?.id !== undefined
      ? await captureActiveTabContext(activeTab.id, existing)
      : null;

  const context: BrowserContextBundle = {
    tabId,
    url: activeTab?.url ?? existing?.url ?? "",
    title: activeTab?.title ?? existing?.title ?? "Current tab",
    selectionText: snapshot?.selectionText ?? existing?.selectionText ?? "",
    summaryMarkdown: snapshot?.summaryMarkdown ?? existing?.summaryMarkdown ?? "",
    openTabsPreview,
    capturedAt: snapshot?.capturedAt ?? new Date().toISOString(),
  };
  if (tabId >= 0) {
    contextByTabId.set(tabId, context);
  }
  await recordDebugLog("context", "active context requested", {
    tabId: context.tabId,
    title: context.title,
    url: context.url,
    selectionLength: context.selectionText.length,
    summaryLength: context.summaryMarkdown.length,
    source: snapshot ? "active-tab-snapshot" : existing ? "cache" : "tab",
  });
  if (options.record !== false) {
    await recordContextHistory("active-context-requested", context);
  }
  return context;
}

async function captureActiveTabContext(
  tabId: number,
  existing?: BrowserContextBundle,
): Promise<Pick<BrowserContextBundle, "selectionText" | "summaryMarkdown" | "capturedAt"> | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: capturePageContextInPage,
    });
    const payloads = results
      .map((result) => result.result)
      .filter(isPageContextPayload);

    if (payloads.length === 0) {
      await recordDebugLog("context", "active tab snapshot returned no payloads", {
        tabId,
      });
      return null;
    }

    const merged = mergeFramePageContexts(payloads);
    const selectionText = resolveSelectionText({
      previousSelectionText: existing?.selectionText ?? "",
      nextSelectionText: merged.selectionText,
      hasFocus: merged.hasFocus,
    });
    const summaryMarkdown = merged.summaryMarkdown || existing?.summaryMarkdown || "";
    const capturedAt = new Date().toISOString();

    await recordDebugLog("context", "active tab snapshot captured", {
      tabId,
      frameCount: payloads.length,
      selectionLength: selectionText.length,
      summaryLength: summaryMarkdown.length,
    });

    return {
      selectionText,
      summaryMarkdown,
      capturedAt,
    };
  } catch (error) {
    await recordDebugLog("context", "active tab snapshot failed", {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function listOpenTabs(): Promise<BrowserTabPreview[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map((tab) => ({
    tabId: tab.id ?? -1,
    title: tab.title ?? tab.url ?? "Untitled tab",
    url: tab.url ?? "",
    active: Boolean(tab.active),
  }));
}

async function isActiveTab(tabId: number): Promise<boolean> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id === tabId;
}

async function publishActiveContextUpdate(reason: string, expectedTabId?: number): Promise<void> {
  const context = await getActiveContext({
    refresh: reason === "page-context-update",
    record: false,
  });
  if (expectedTabId !== undefined && context.tabId !== expectedTabId) {
    return;
  }

  const message: BackgroundRuntimeMessage = {
    type: "browser-acp/context-changed",
    context,
  };

  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Ignore the case where no side panel is open to receive live context updates.
  }

  await recordDebugLog("context", "active context broadcast", {
    reason,
    tabId: context.tabId,
    title: context.title,
    url: context.url,
    selectionLength: context.selectionText.length,
  });
  await recordContextHistory(reason, context);
}

async function openNativeSidePanel(windowId?: number): Promise<void> {
  let nextWindowId = windowId;
  if (nextWindowId === undefined) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    nextWindowId = activeTab?.windowId;
  }

  if (nextWindowId === undefined) {
    return;
  }

  try {
    await chrome.sidePanel.open({
      windowId: nextWindowId,
    });
  } catch (error) {
    await recordDebugLog("background", "tab message failed", {
      windowId: nextWindowId,
      type: "sidePanel.open",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyRuntime(message: BackgroundRuntimeMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    await recordDebugLog("background", "runtime message failed", {
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isPageContextPayload(value: unknown): value is PageContextPayload {
  return (
    value !== null &&
    typeof value === "object" &&
    "selectionText" in value &&
    "summaryMarkdown" in value &&
    "hasFocus" in value
  );
}

async function ensureDaemon(): Promise<NativeHostBootstrapResponse> {
  if (bootstrapCache?.ok) {
    await recordDebugLog("native-host", "refreshing cached daemon bootstrap", {
      port: bootstrapCache.port,
      pid: bootstrapCache.pid,
    });
  }

  if (!bootstrapRequest) {
    bootstrapRequest = requestDaemonBootstrap().finally(() => {
      bootstrapRequest = null;
    });
  }

  bootstrapCache = await bootstrapRequest;

  if (!bootstrapCache.ok || !bootstrapCache.port || !bootstrapCache.token) {
    throw new Error(bootstrapCache.message ?? "Failed to bootstrap daemon");
  }

  return bootstrapCache;
}

async function requestDaemonBootstrap(): Promise<NativeHostBootstrapResponse> {
  await recordDebugLog("native-host", "requesting daemon bootstrap", {
    host: BROWSER_ACP_NATIVE_HOST_NAME,
  });
  const bootstrap = await sendNativeMessage({
    command: "ensureDaemon",
  });
  await recordDebugLog("native-host", "daemon bootstrap response received", bootstrap);
  return bootstrap;
}

async function fetchDaemonJson<T>(
  bootstrap: NativeHostBootstrapResponse,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  await recordDebugLog("daemon", "sending HTTP request", {
    path,
    method: init.method ?? "GET",
    port: bootstrap.port,
  });
  let response: Response;
  try {
    response = await fetch(`${createDaemonBaseUrl(bootstrap.port!)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${bootstrap.token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    await recordDebugLog("daemon", "HTTP request failed before response", {
      path,
      method: init.method ?? "GET",
      port: bootstrap.port,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const rawBody = await response.text();
  await recordDebugLog("daemon", "received HTTP response", {
    path,
    status: response.status,
    ok: response.ok,
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Daemon request failed: ${response.status}`);
  }

  return JSON.parse(rawBody) as T;
}

function sendNativeMessage(message: { command: "ensureDaemon" | "getDaemonStatus" | "openLogs" }): Promise<NativeHostBootstrapResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(BROWSER_ACP_NATIVE_HOST_NAME, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        void recordDebugLog("native-host", "native message failed", {
          command: message.command,
          error: lastError.message,
        });
        reject(new Error(lastError.message));
        return;
      }

      resolve(response as NativeHostBootstrapResponse);
    });
  });
}

async function getDebugState(): Promise<BackgroundDebugState> {
  await hydrateDebugLogs();

  let daemonStatus: NativeHostBootstrapResponse | null = null;
  let daemonLogs: DebugLogEntry[] = [];
  try {
    daemonStatus = await sendNativeMessage({
      command: "getDaemonStatus",
    });
  } catch (error) {
    daemonStatus = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const daemonBootstrap =
    daemonStatus?.ok && daemonStatus.port && daemonStatus.token
      ? daemonStatus
      : bootstrapCache?.ok && bootstrapCache.port && bootstrapCache.token
        ? bootstrapCache
        : null;

  if (daemonBootstrap) {
    try {
      daemonLogs = await fetchDaemonJson<DebugLogEntry[]>(daemonBootstrap, "/debug/logs");
    } catch (error) {
      await recordDebugLog("daemon", "failed to fetch daemon debug logs", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    extensionId: chrome.runtime.id,
    nativeHostName: BROWSER_ACP_NATIVE_HOST_NAME,
    daemonBaseUrl: DAEMON_BASE_ORIGIN,
    bootstrapCache,
    daemonStatus,
    daemonLogs,
    logs: [...debugLogs],
    contextHistory: await listContextHistory(),
  };
}

async function listPageTaskTemplates(): Promise<PageTaskTemplate[]> {
  try {
    const stored = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.pageTaskTemplates);
    return sanitizePageTaskTemplates(stored[EXTENSION_STORAGE_KEYS.pageTaskTemplates]);
  } catch {
    return sanitizePageTaskTemplates(null);
  }
}

async function updatePageTaskTemplates(templates: PageTaskTemplate[]): Promise<{ ok: true }> {
  const sanitized = sanitizePageTaskTemplates(templates);
  await chrome.storage.local.set({
    [EXTENSION_STORAGE_KEYS.pageTaskTemplates]: sanitized,
  });
  await notifyRuntime({
    type: "browser-acp/page-task-templates-changed",
    templates: sanitized,
  });
  return { ok: true };
}

async function hydrateContextHistory(): Promise<void> {
  if (contextHistoryHydrated) {
    return;
  }

  contextHistoryHydrated = true;
  try {
    const stored = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.contextHistory);
    const persistedHistory = stored[EXTENSION_STORAGE_KEYS.contextHistory];
    if (Array.isArray(persistedHistory)) {
      contextHistory.splice(0, contextHistory.length, ...persistedHistory.filter(isContextTimelineEntry).slice(-CONTEXT_HISTORY_LIMIT));
    }
  } catch {
    // Ignore storage hydration failures.
  }
}

async function listContextHistory(): Promise<BrowserContextTimelineEntry[]> {
  await hydrateContextHistory();
  return [...contextHistory];
}

async function recordContextHistory(reason: string, context: BrowserContextBundle): Promise<void> {
  await hydrateContextHistory();
  contextHistory.push({
    id: crypto.randomUUID(),
    reason,
    capturedAt: new Date().toISOString(),
    context,
  });
  if (contextHistory.length > CONTEXT_HISTORY_LIMIT) {
    contextHistory.splice(0, contextHistory.length - CONTEXT_HISTORY_LIMIT);
  }
  try {
    await chrome.storage.local.set({
      [EXTENSION_STORAGE_KEYS.contextHistory]: contextHistory,
    });
  } catch {
    // Ignore storage persistence failures.
  }
}

async function hydrateDebugLogs(): Promise<void> {
  if (debugLogsHydrated) {
    return;
  }

  debugLogsHydrated = true;
  try {
    const stored = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.debugLogs);
    const persistedLogs = stored[EXTENSION_STORAGE_KEYS.debugLogs];
    if (Array.isArray(persistedLogs)) {
      debugLogs.splice(0, debugLogs.length, ...persistedLogs.slice(-DEBUG_LOG_LIMIT));
    }
  } catch {
    // Ignore storage hydration failures.
  }
}

async function persistPendingSelectionAction(action: PendingSelectionAction): Promise<void> {
  await chrome.storage.local.set({
    [EXTENSION_STORAGE_KEYS.pendingSelectionAction]: action,
  });
}

async function loadPendingSelectionAction(): Promise<PendingSelectionAction | null> {
  try {
    const stored = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.pendingSelectionAction);
    const persistedAction = stored[EXTENSION_STORAGE_KEYS.pendingSelectionAction];
    return isPendingSelectionAction(persistedAction) ? persistedAction : null;
  } catch {
    return null;
  }
}

async function clearPendingSelectionAction(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [EXTENSION_STORAGE_KEYS.pendingSelectionAction]: null,
    });
  } catch {
    // Ignore storage persistence failures.
  }
}

async function recordDebugLog(
  scope: string,
  message: string,
  details?: unknown,
): Promise<void> {
  await hydrateDebugLogs();

  const entry: BackgroundDebugLogEntry = {
    timestamp: new Date().toISOString(),
    scope,
    message,
    details: details === undefined ? undefined : sanitizeDebugValue(details),
  };

  debugLogs.push(entry);
  if (debugLogs.length > DEBUG_LOG_LIMIT) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOG_LIMIT);
  }

  console.info(`[Browser ACP][${scope}] ${message}`, entry.details);
  try {
    await chrome.storage.local.set({
      [EXTENSION_STORAGE_KEYS.debugLogs]: debugLogs,
    });
  } catch {
    // Ignore storage persistence failures.
  }
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 400 ? `${value.slice(0, 397)}...` : value;
  }

  if (depth >= 3) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeDebugValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, entryValue]) => [key, sanitizeDebugValue(entryValue, depth + 1)]),
    );
  }

  return String(value);
}

function isPendingSelectionAction(value: unknown): value is PendingSelectionAction {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "templateId" in value &&
    typeof value.templateId === "string" &&
    "templateTitle" in value &&
    typeof value.templateTitle === "string" &&
    "selectionText" in value &&
    typeof value.selectionText === "string" &&
    "promptText" in value &&
    typeof value.promptText === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

function isContextTimelineEntry(value: unknown): value is BrowserContextTimelineEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.reason === "string" &&
    typeof record.capturedAt === "string" &&
    isBrowserContextBundle(record.context)
  );
}

function isBrowserContextBundle(value: unknown): value is BrowserContextBundle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.tabId === "number" &&
    typeof record.url === "string" &&
    typeof record.title === "string" &&
    typeof record.selectionText === "string" &&
    typeof record.summaryMarkdown === "string" &&
    Array.isArray(record.openTabsPreview) &&
    typeof record.capturedAt === "string"
  );
}
