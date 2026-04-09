import { describe, expect, it } from "vitest";
import { collectExtensionIdsFromPreferences, createNativeHostManifest } from "../src/installManifest.js";

describe("collectExtensionIdsFromPreferences", () => {
  it("finds Browser ACP extension ids from Chrome preference payloads", () => {
    const extensionIds = collectExtensionIdsFromPreferences([
      {
        extensions: {
          settings: {
            abcdefghijklmnopabcdefghijklmnop: {
              manifest: {
                name: "Browser ACP",
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
      name: "com.browser_acp.host",
      path: "/tmp/browser-acp-host.sh",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });
  });
});
