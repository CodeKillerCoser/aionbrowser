import { describe, expect, it } from "vitest";
import {
  BROWSER_ACP_EXTENSION_DISPLAY_NAME,
  NATIVE_HOST_NAME,
} from "../src/config/nativeHostConfig.js";
import { collectExtensionIdsFromPreferences, createNativeHostManifest } from "../src/installManifest.js";
import {
  resolveBrowserAcpRootDir,
  resolveChromeNativeMessagingHostsDir,
  resolveChromeRootDir,
} from "../src/platform/chromePaths.js";

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
