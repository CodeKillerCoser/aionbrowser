export const BROWSER_ACP_EXTENSION_NAME = "Browser ACP";
export const BROWSER_ACP_NATIVE_HOST_NAME = "com.browser_acp.host";
export const BROWSER_ACP_APP_SUPPORT_DIR_NAME = "browser-acp";

export const DAEMON_PROTOCOL = "http";
export const DAEMON_HOST = "127.0.0.1";
export const DAEMON_BASE_ORIGIN = `${DAEMON_PROTOCOL}://${DAEMON_HOST}`;
export const DAEMON_LOG_FILE_NAME = "daemon.log";
export const DAEMON_STATE_FILE_NAME = "daemon-state.json";

export const SIDEPANEL_DEFAULT_PATH = "sidepanel.html";

export const EXTENSION_STORAGE_KEYS = {
  debugLogs: "browser-acp-debug-logs",
  pendingSelectionAction: "browser-acp-pending-selection-action",
} as const;

export const SELECTION_ACTION_PROMPTS = {
  explain: (selectionText: string) =>
    `请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\n${selectionText.trim()}`,
  search: (selectionText: string) =>
    `请基于下面这段内容，提炼搜索关键词、核心问题，并给出后续搜索方向：\n\n${selectionText.trim()}`,
  examples: (selectionText: string) =>
    `请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\n${selectionText.trim()}`,
} as const;

export function createDaemonBaseUrl(port: number): string {
  return `${DAEMON_BASE_ORIGIN}:${port}`;
}
