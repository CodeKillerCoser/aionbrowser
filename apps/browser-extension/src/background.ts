import type { BrowserContextBundle, BrowserTabPreview, NativeHostBootstrapResponse, ResolvedAgent, ConversationSummary, DebugLogEntry } from "@browser-acp/shared-types";
import type {
  BackgroundDebugLogEntry,
  BackgroundDebugState,
  BackgroundRequest,
  BackgroundRuntimeMessage,
  PendingSelectionAction,
  PageContextPayload,
  SelectionActionType,
} from "./messages";
import { resolveSelectionText } from "./contextState";
import { mergeFramePageContexts } from "./frameContext";
import { capturePageContextInPage } from "./pageCapture";

const NATIVE_HOST_NAME = "com.browser_acp.host";
const DAEMON_BASE_URL = "http://127.0.0.1";
const DEBUG_STORAGE_KEY = "browser-acp-debug-logs";
const PENDING_SELECTION_ACTION_STORAGE_KEY = "browser-acp-pending-selection-action";
const DEBUG_LOG_LIMIT = 120;

const contextByTabId = new Map<number, BrowserContextBundle>();
const debugLogs: BackgroundDebugLogEntry[] = [];
let bootstrapCache: NativeHostBootstrapResponse | null = null;
let debugLogsHydrated = false;
let pendingSelectionAction: PendingSelectionAction | null = null;
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
  if (message.type === "browser-acp/context-update") {
    return updateContextFromPage(message.payload, sender);
  }

  if (message.type === "browser-acp/ensure-daemon") {
    return ensureDaemon();
  }

  if (message.type === "browser-acp/list-agents") {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ResolvedAgent[]>(bootstrap, "/agents");
  }

  if (message.type === "browser-acp/list-sessions") {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ConversationSummary[]>(bootstrap, "/sessions");
  }

  if (message.type === "browser-acp/get-active-context") {
    return getActiveContext({ refresh: true });
  }

  if (message.type === "browser-acp/get-debug-state") {
    return getDebugState();
  }

  if (message.type === "browser-acp/create-session") {
    const bootstrap = await ensureDaemon();
    return fetchDaemonJson<ConversationSummary>(bootstrap, "/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: message.agentId,
        context: message.context,
      }),
    });
  }

  if (message.type === "browser-acp/trigger-selection-action") {
    return triggerSelectionAction(message, sender);
  }

  if (message.type === "browser-acp/claim-pending-selection-action") {
    return claimPendingSelectionAction();
  }

  return { ok: false, error: "Unsupported message" };
}

async function triggerSelectionAction(
  message: Extract<BackgroundRequest, { type: "browser-acp/trigger-selection-action" }>,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: true }> {
  pendingSelectionAction = {
    id: crypto.randomUUID(),
    action: message.action,
    selectionText: message.selectionText,
    promptText: buildSelectionActionPrompt(message.action, message.selectionText),
    createdAt: new Date().toISOString(),
  };

  await openNativeSidePanel(sender.tab?.windowId);
  await persistPendingSelectionAction(pendingSelectionAction);
  await notifyRuntime({
    type: "browser-acp/selection-action-ready",
  });

  await recordDebugLog("selection-action", "selection action queued", {
    action: message.action,
    selectionLength: message.selectionText.length,
    tabId: sender.tab?.id,
    windowId: sender.tab?.windowId,
  });

  return { ok: true };
}

async function claimPendingSelectionAction(): Promise<PendingSelectionAction | null> {
  const nextAction = pendingSelectionAction ?? await loadPendingSelectionAction();
  pendingSelectionAction = null;
  await clearPendingSelectionAction();
  return nextAction;
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

async function getActiveContext(options: { refresh?: boolean } = {}): Promise<BrowserContextBundle> {
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

function buildSelectionActionPrompt(action: SelectionActionType, selectionText: string): string {
  const trimmedSelectionText = selectionText.trim();
  if (action === "explain") {
    return `请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\n${trimmedSelectionText}`;
  }

  if (action === "search") {
    return `请基于下面这段内容，提炼搜索关键词、核心问题，并给出后续搜索方向：\n\n${trimmedSelectionText}`;
  }

  return `请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\n${trimmedSelectionText}`;
}

async function ensureDaemon(): Promise<NativeHostBootstrapResponse> {
  if (bootstrapCache?.ok) {
    await recordDebugLog("native-host", "using cached daemon bootstrap", {
      port: bootstrapCache.port,
      pid: bootstrapCache.pid,
    });
    return bootstrapCache;
  }

  await recordDebugLog("native-host", "requesting daemon bootstrap", {
    host: NATIVE_HOST_NAME,
  });
  bootstrapCache = await sendNativeMessage({
    command: "ensureDaemon",
  });
  await recordDebugLog("native-host", "daemon bootstrap response received", bootstrapCache);

  if (!bootstrapCache.ok || !bootstrapCache.port || !bootstrapCache.token) {
    throw new Error(bootstrapCache.message ?? "Failed to bootstrap daemon");
  }

  return bootstrapCache;
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
    response = await fetch(`${DAEMON_BASE_URL}:${bootstrap.port}${path}`, {
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
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
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
    nativeHostName: NATIVE_HOST_NAME,
    daemonBaseUrl: DAEMON_BASE_URL,
    bootstrapCache,
    daemonStatus,
    daemonLogs,
    logs: [...debugLogs],
  };
}

async function hydrateDebugLogs(): Promise<void> {
  if (debugLogsHydrated) {
    return;
  }

  debugLogsHydrated = true;
  try {
    const stored = await chrome.storage.local.get(DEBUG_STORAGE_KEY);
    const persistedLogs = stored[DEBUG_STORAGE_KEY];
    if (Array.isArray(persistedLogs)) {
      debugLogs.splice(0, debugLogs.length, ...persistedLogs.slice(-DEBUG_LOG_LIMIT));
    }
  } catch {
    // Ignore storage hydration failures.
  }
}

async function persistPendingSelectionAction(action: PendingSelectionAction): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_SELECTION_ACTION_STORAGE_KEY]: action,
  });
}

async function loadPendingSelectionAction(): Promise<PendingSelectionAction | null> {
  try {
    const stored = await chrome.storage.local.get(PENDING_SELECTION_ACTION_STORAGE_KEY);
    const persistedAction = stored[PENDING_SELECTION_ACTION_STORAGE_KEY];
    return isPendingSelectionAction(persistedAction) ? persistedAction : null;
  } catch {
    return null;
  }
}

async function clearPendingSelectionAction(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [PENDING_SELECTION_ACTION_STORAGE_KEY]: null,
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
      [DEBUG_STORAGE_KEY]: debugLogs,
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
    "action" in value &&
    (value.action === "explain" || value.action === "search" || value.action === "examples") &&
    "selectionText" in value &&
    typeof value.selectionText === "string" &&
    "promptText" in value &&
    typeof value.promptText === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}
