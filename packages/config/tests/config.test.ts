import { describe, expect, it } from "vitest";
import {
  BROWSER_ACP_NATIVE_HOST_NAME,
  DAEMON_HOST,
  DAEMON_LOG_FILE_NAME,
  EXTENSION_STORAGE_KEYS,
  SIDEPANEL_DEFAULT_PATH,
  createDaemonBaseUrl,
} from "../src/index";

describe("shared config", () => {
  it("exposes one authoritative runtime-safe constant set", () => {
    expect(BROWSER_ACP_NATIVE_HOST_NAME).toBe("com.browser_acp.host");
    expect(DAEMON_HOST).toBe("127.0.0.1");
    expect(createDaemonBaseUrl(57603)).toBe("http://127.0.0.1:57603");
    expect(DAEMON_LOG_FILE_NAME).toBe("daemon.log");
    expect(SIDEPANEL_DEFAULT_PATH).toBe("sidepanel.html");
    expect(EXTENSION_STORAGE_KEYS.debugLogs).toBe("browser-acp-debug-logs");
    expect(EXTENSION_STORAGE_KEYS.pageTaskTemplates).toBe("browser-acp-page-task-templates");
    expect(EXTENSION_STORAGE_KEYS.contextHistory).toBe("browser-acp-context-history");
  });
});
