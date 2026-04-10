import { homedir } from "node:os";
import { join } from "node:path";
import { BROWSER_ACP_ROOT_DIR_NAME } from "../config/nativeHostConfig.js";

const MACOS_APP_SUPPORT_SEGMENTS = ["Library", "Application Support"] as const;
const CHROME_ROOT_SEGMENTS = ["Google", "Chrome"] as const;
const NATIVE_MESSAGING_HOSTS_DIR_NAME = "NativeMessagingHosts";

export function resolveMacOsAppSupportDir(homeDir = homedir()): string {
  return join(homeDir, ...MACOS_APP_SUPPORT_SEGMENTS);
}

export function resolveBrowserAcpRootDir(homeDir = homedir()): string {
  return join(resolveMacOsAppSupportDir(homeDir), BROWSER_ACP_ROOT_DIR_NAME);
}

export function resolveChromeRootDir(homeDir = homedir()): string {
  return join(resolveMacOsAppSupportDir(homeDir), ...CHROME_ROOT_SEGMENTS);
}

export function resolveChromeNativeMessagingHostsDir(homeDir = homedir()): string {
  return join(resolveChromeRootDir(homeDir), NATIVE_MESSAGING_HOSTS_DIR_NAME);
}
