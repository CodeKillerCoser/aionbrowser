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
  pageTaskTemplates: "browser-acp-page-task-templates",
  contextHistory: "browser-acp-context-history",
} as const;

export function createDaemonBaseUrl(port: number): string {
  return `${DAEMON_BASE_ORIGIN}:${port}`;
}
