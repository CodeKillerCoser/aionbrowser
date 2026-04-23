import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedAgent } from "@browser-acp/shared-types";
import { prepareAgentLaunch } from "../src/runtime/agentLaunch.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("agent launch instruction injection", () => {
  it("adds Gemini context files through include directories and system settings", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("gemini-cli", "Gemini CLI", "gemini", ["--experimental-acp"]),
      cwd: rootDir,
    });

    const includeIndex = launch.args.indexOf("--include-directories");
    const includeDir = launch.args[includeIndex + 1];

    expect(includeIndex).toBeGreaterThanOrEqual(0);
    expect(basename(includeDir)).toBe("gemini");
    expect(launch.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBe(
      join(includeDir, "system-settings.json"),
    );
    expect(existsSync(join(includeDir, "GEMINI.md"))).toBe(true);
    expect(readFileSync(join(includeDir, "GEMINI.md"), "utf8")).toContain("Browser ACP");
    expect(JSON.parse(readFileSync(join(includeDir, "system-settings.json"), "utf8"))).toEqual({
      context: {
        includeDirectories: [includeDir],
        loadMemoryFromIncludeDirectories: true,
      },
    });
  });

  it("adds Qwen context files through include directories and ACP settings", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("qwen-code", "Qwen Code", "qwen", ["--acp"]),
      cwd: rootDir,
    });

    const includeIndex = launch.args.indexOf("--include-directories");
    const includeDir = launch.args[includeIndex + 1];

    expect(includeIndex).toBeGreaterThanOrEqual(0);
    expect(basename(includeDir)).toBe("qwen");
    expect(launch.env?.QWEN_CODE_SYSTEM_SETTINGS_PATH).toBe(
      join(includeDir, "system-settings.json"),
    );
    expect(launch.newSessionSettings).toEqual({
      add_dirs: [includeDir],
      append_system_prompt: expect.stringContaining("Browser ACP"),
    });
    expect(existsSync(join(includeDir, "QWEN.md"))).toBe(true);
    expect(readFileSync(join(includeDir, "QWEN.md"), "utf8")).toContain("Browser ACP");
    expect(JSON.parse(readFileSync(join(includeDir, "system-settings.json"), "utf8"))).toEqual({
      context: {
        includeDirectories: [includeDir],
        loadFromIncludeDirectories: true,
      },
    });
  });

  it("uses a prompt prefix fallback for Qoder because its ACP metadata is ignored", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("qoder-cli", "Qoder CLI", "qodercli", ["--acp"]),
      cwd: rootDir,
    });

    expect(launch.args).toEqual(["--acp"]);
    expect(launch.newSessionAdditionalDirectories).toBeUndefined();
    expect(launch.newSessionMeta).toBeUndefined();
    expect(launch.promptPrefix).toContain("Browser ACP");
  });

  it("adds Codex model instructions file through config override", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("codex-cli", "Codex CLI", "codex", ["acp"]),
      cwd: rootDir,
    });

    const configIndex = launch.args.indexOf("-c");
    const configValue = launch.args[configIndex + 1];

    expect(configIndex).toBe(0);
    expect(configValue).toContain("model_instructions_file=");
    expect(configValue).toContain(".browser-acp");
    expect(configValue).toContain("AGENTS.md");
    expect(existsSync(configValue.match(/\"(.+)\"/)?.[1] ?? "")).toBe(true);
  });

  it("adds Claude append-system-prompt-file before existing args", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("claude-agent", "Claude Code", "claude", ["--some-acp-adapter"]),
      cwd: rootDir,
    });

    const promptFile = launch.args[1];

    expect(launch.args.slice(0, 2)).toEqual(["--append-system-prompt-file", promptFile]);
    expect(existsSync(promptFile)).toBe(true);
    expect(readFileSync(promptFile, "utf8")).toContain("Browser ACP");
  });

  it("passes Claude ACP adapter instructions through new session metadata", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-launch-"));
    tempDirs.push(rootDir);

    const launch = await prepareAgentLaunch({
      agent: agent("claude-agent", "Claude Code", "npx", ["@zed-industries/claude-code-acp"]),
      cwd: rootDir,
    });

    expect(launch.args).toEqual(["@zed-industries/claude-code-acp"]);
    expect(launch.newSessionMeta).toEqual({
      systemPrompt: {
        append: expect.stringContaining("Browser ACP"),
      },
    });
    expect(
      existsSync(join(rootDir, ".browser-acp", "tmp", "agent-instructions", "claude-acp", "browser-acp-instructions.md")),
    ).toBe(true);
  });
});

function agent(id: string, name: string, command: string, args: string[]): ResolvedAgent {
  return {
    id,
    name,
    source: "user",
    distribution: {
      type: "custom",
      command,
      args,
    },
    status: "launchable",
    launchCommand: command,
    launchArgs: args,
  };
}
