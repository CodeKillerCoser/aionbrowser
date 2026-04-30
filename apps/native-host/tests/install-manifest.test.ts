import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_ACP_EXTENSION_DISPLAY_NAME,
  NATIVE_HOST_NAME,
} from "../src/config/nativeHostConfig.js";
import { collectExtensionIdsFromPreferences, createNativeHostManifest, installChromeNativeHost } from "../src/installManifest.js";
import {
  resolveBrowserAcpRootDir,
  resolveChromeNativeMessagingHostsDir,
  resolveChromeRootDir,
} from "../src/platform/chromePaths.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("nativeHostConfig", () => {
  it("re-exports the canonical extension and host names", () => {
    expect(BROWSER_ACP_EXTENSION_DISPLAY_NAME).toBe("Browser ACP");
    expect(NATIVE_HOST_NAME).toBe("com.browser_acp.host");
  });
});

describe("chromePaths", () => {
  it("derives browser ACP and Chrome directories from a home directory", () => {
    expect(resolveBrowserAcpRootDir("/Users/example")).toBe(
      "/Users/example/Library/Application Support/browser-acp",
    );
    expect(resolveChromeRootDir("/Users/example")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome",
    );
    expect(resolveChromeNativeMessagingHostsDir("/Users/example")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
  });
});

describe("collectExtensionIdsFromPreferences", () => {
  it("finds Browser ACP extension ids from Chrome preference payloads", () => {
    const extensionIds = collectExtensionIdsFromPreferences([
      {
        extensions: {
          settings: {
            abcdefghijklmnopabcdefghijklmnop: {
              manifest: {
                name: BROWSER_ACP_EXTENSION_DISPLAY_NAME,
              },
            },
            zyxwvutsrqponmlkjihgfedcbazyxwvu: {
              manifest: {
                name: "Another Extension",
              },
            },
          },
        },
      },
    ]);

    expect(extensionIds).toEqual(["abcdefghijklmnopabcdefghijklmnop"]);
  });
});

describe("createNativeHostManifest", () => {
  it("maps extension ids to allowed origins", () => {
    const manifest = createNativeHostManifest({
      hostPath: "/tmp/browser-acp-host.sh",
      extensionIds: ["abcdefghijklmnopabcdefghijklmnop"],
    });

    expect(manifest).toMatchObject({
      name: NATIVE_HOST_NAME,
      path: "/tmp/browser-acp-host.sh",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });
  });
});

describe("installChromeNativeHost", () => {
  it("copies packaged host files into app support before writing the launcher", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-native-install-"));
    tempDirs.push(rootDir);
    const packageDir = join(rootDir, "release", "native-host");
    const hostRootDir = join(rootDir, "app-support");
    const manifestDir = join(rootDir, "chrome-hosts");
    const nativeHostEntry = join(packageDir, "host.mjs");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(nativeHostEntry, "console.log('host');", "utf8");
    writeFileSync(join(packageDir, "daemon.mjs"), "console.log('daemon');", "utf8");

    const result = await installChromeNativeHost({
      extensionIds: ["abcdefghijklmnopabcdefghijklmnop"],
      hostRootDir,
      manifestDir,
      nativeHostEntry,
      nodePath: "/usr/local/bin/node",
    });

    const installedHostPath = join(hostRootDir, "native-host", "host.mjs");
    expect(readFileSync(installedHostPath, "utf8")).toBe("console.log('host');");
    expect(readFileSync(join(hostRootDir, "native-host", "daemon.mjs"), "utf8")).toBe("console.log('daemon');");
    expect(readFileSync(result.launcherPath, "utf8")).toContain(installedHostPath);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toMatchObject({
      path: result.launcherPath,
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });
  });
});
