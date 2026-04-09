import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("browser extension manifest", () => {
  it("declares the native side panel while keeping the content script context capture hooks", () => {
    const manifestConfigPath = resolve(__dirname, "../manifest.config.ts");
    const manifestConfigSource = readFileSync(manifestConfigPath, "utf8");

    expect(manifestConfigSource).toContain("\"sidePanel\"");
    expect(manifestConfigSource).toContain("side_panel");
    expect(manifestConfigSource).toContain("sidepanel.html");
    expect(manifestConfigSource).toContain("all_frames: true");
    expect(manifestConfigSource).toContain("match_about_blank: true");
    expect(manifestConfigSource).toContain("match_origin_as_fallback: true");
  });
});
