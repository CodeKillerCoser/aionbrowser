import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDaemonRunning } from "../src/daemonBootstrap.js";
import { buildDaemonEnvironment } from "../src/daemonBootstrap.js";
import { loadLoginShellEnvironment } from "../src/daemonBootstrap.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("ensureDaemonRunning", () => {
  it("reuses an existing healthy daemon without spawning a new one", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-native-host-"));
    tempDirs.push(rootDir);

    writeFileSync(
      join(rootDir, "daemon-state.json"),
      JSON.stringify({
        port: 4317,
        token: "existing-token",
        pid: 1234,
        daemonFingerprint: "same-build",
      }),
      "utf8",
    );

    const startDaemon = vi.fn();
    const result = await ensureDaemonRunning({
      rootDir,
      defaultCwd: rootDir,
      healthCheck: vi.fn().mockResolvedValue(true),
      startDaemon,
      pickPort: vi.fn().mockResolvedValue(4317),
      generateToken: vi.fn().mockReturnValue("new-token"),
      getDaemonFingerprint: vi.fn().mockResolvedValue("same-build"),
    });

    expect(startDaemon).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      port: 4317,
      token: "existing-token",
      pid: 1234,
    });
  });

  it("starts a replacement daemon when the built daemon entry changed", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-native-host-"));
    tempDirs.push(rootDir);

    writeFileSync(
      join(rootDir, "daemon-state.json"),
      JSON.stringify({
        port: 4317,
        token: "existing-token",
        pid: 1234,
        daemonFingerprint: "old-build",
      }),
      "utf8",
    );

    const startDaemon = vi.fn().mockResolvedValue({ pid: 9876 });
    const result = await ensureDaemonRunning({
      rootDir,
      defaultCwd: rootDir,
      healthCheck: vi.fn().mockResolvedValue(true),
      startDaemon,
      pickPort: vi.fn().mockResolvedValue(6123),
      generateToken: vi.fn().mockReturnValue("new-token"),
      getDaemonFingerprint: vi.fn().mockResolvedValue("new-build"),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(startDaemon).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      port: 6123,
      token: "new-token",
      pid: 9876,
    });
  });

  it("spawns a new daemon and persists fresh state when no healthy daemon exists", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-native-host-"));
    tempDirs.push(rootDir);

    const healthCheck = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await ensureDaemonRunning({
      rootDir,
      defaultCwd: rootDir,
      healthCheck,
      startDaemon: vi.fn().mockResolvedValue({ pid: 9876 }),
      pickPort: vi.fn().mockResolvedValue(6123),
      generateToken: vi.fn().mockReturnValue("spawned-token"),
      getDaemonFingerprint: vi.fn().mockResolvedValue("spawned-build"),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toMatchObject({
      ok: true,
      port: 6123,
      token: "spawned-token",
      pid: 9876,
    });
    expect(healthCheck).toHaveBeenCalledTimes(3);
    expect(readFileSync(join(rootDir, "daemon.log"), "utf8")).toContain("\"message\":\"daemon state persisted\"");
  });
});

describe("buildDaemonEnvironment", () => {
  it("prefers PATH and variables from the login shell environment", () => {
    const merged = buildDaemonEnvironment(
      {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/example",
      },
      {
        PATH: "/Users/example/.npm-global/bin:/opt/homebrew/bin",
        SHELL: "/bin/zsh",
      },
    );

    expect(merged.PATH).toBe("/Users/example/.npm-global/bin:/opt/homebrew/bin");
    expect(merged.SHELL).toBe("/bin/zsh");
    expect(merged.HOME).toBe("/Users/example");
  });
});

describe("loadLoginShellEnvironment", () => {
  it("reads PATH from the user's login shell", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "PATH=/Users/example/.npm-global/bin:/opt/homebrew/bin\u0000SHELL=/bin/zsh\u0000",
      stderr: "",
    }));

    const shellEnv = await loadLoginShellEnvironment("/bin/zsh", execFile);

    expect(execFile).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-lc", "env -0"],
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
    expect(shellEnv.PATH).toBe("/Users/example/.npm-global/bin:/opt/homebrew/bin");
    expect(shellEnv.SHELL).toBe("/bin/zsh");
  });
});
