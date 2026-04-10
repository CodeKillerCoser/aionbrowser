import { randomUUID } from "node:crypto";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:net";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  DAEMON_HOST,
  DAEMON_LOG_FILE_NAME,
  DAEMON_STATE_FILE_NAME,
  createDaemonBaseUrl,
} from "@browser-acp/config";
import type { NativeHostBootstrapResponse } from "@browser-acp/shared-types";
import { createFileDebugLogger } from "./debugLog.js";
import { resolveBrowserAcpRootDir } from "./platform/chromePaths.js";

interface DaemonState {
  port: number;
  token: string;
  pid: number;
}

interface StartDaemonInput {
  port: number;
  token: string;
  rootDir: string;
  defaultCwd: string;
  logPath: string;
}

interface EnsureDaemonRunningOptions {
  rootDir: string;
  defaultCwd: string;
  healthCheck?: (state: DaemonState) => Promise<boolean>;
  startDaemon?: (input: StartDaemonInput) => Promise<{ pid: number }>;
  pickPort?: () => Promise<number>;
  generateToken?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

const execFile = promisify(execFileCallback);
const DAEMON_READY_RETRY_DELAY_MS = 150;
const DAEMON_READY_MAX_ATTEMPTS = 40;

export async function ensureDaemonRunning(
  options: EnsureDaemonRunningOptions,
): Promise<NativeHostBootstrapResponse> {
  await mkdir(options.rootDir, { recursive: true });

  const statePath = join(options.rootDir, DAEMON_STATE_FILE_NAME);
  const logPath = join(options.rootDir, DAEMON_LOG_FILE_NAME);
  const logger = createFileDebugLogger(logPath);
  const healthCheck = options.healthCheck ?? defaultHealthCheck;
  const startDaemon = options.startDaemon ?? defaultStartDaemon;
  const pickPort = options.pickPort ?? pickAvailablePort;
  const generateToken = options.generateToken ?? randomUUID;
  const sleep = options.sleep ?? defaultSleep;

  await logger.log("native-host", "ensure daemon requested", {
    rootDir: options.rootDir,
    defaultCwd: options.defaultCwd,
  });

  const existing = await readState(statePath);
  if (existing) {
    await logger.log("native-host", "existing daemon state found", existing);
  }
  if (existing && (await healthCheck(existing))) {
    await logger.log("native-host", "existing daemon is healthy; reusing cached state", existing);
    return {
      ok: true,
      ...existing,
      logPath,
    };
  }
  if (existing) {
    await logger.log("native-host", "existing daemon state is stale; starting a replacement daemon", existing);
  }

  const nextState: DaemonState = {
    port: await pickPort(),
    token: generateToken(),
    pid: 0,
  };
  await logger.log("native-host", "starting daemon process", {
    port: nextState.port,
  });

  const started = await startDaemon({
    port: nextState.port,
    token: nextState.token,
    rootDir: options.rootDir,
    defaultCwd: options.defaultCwd,
    logPath,
  });

  nextState.pid = started.pid;
  await logger.log("native-host", "daemon process spawned", {
    pid: nextState.pid,
    port: nextState.port,
  });
  const healthy = await waitForDaemonReady(nextState, healthCheck, sleep, logger);
  if (!healthy) {
    await logger.log("native-host", "daemon readiness timed out", nextState);
    throw new Error("Daemon did not become ready before timeout.");
  }
  await writeFile(statePath, JSON.stringify(nextState, null, 2), "utf8");
  await logger.log("native-host", "daemon state persisted", nextState);

  return {
    ok: true,
    ...nextState,
    logPath,
  };
}

export async function getDaemonStatus(rootDir: string): Promise<NativeHostBootstrapResponse> {
  const state = await readState(join(rootDir, DAEMON_STATE_FILE_NAME));
  const logPath = join(rootDir, DAEMON_LOG_FILE_NAME);
  const logger = createFileDebugLogger(logPath);
  await logger.log("native-host", "daemon status requested", {
    rootDir,
  });

  if (!state) {
    await logger.log("native-host", "daemon status check found no saved state");
    return {
      ok: false,
      message: "Daemon has not been started yet.",
      logPath,
    };
  }

  const healthy = await defaultHealthCheck(state);
  if (!healthy) {
    await logger.log("native-host", "daemon status check found stale state", state);
    return {
      ok: false,
      message: "Saved daemon state is stale or unreachable.",
      logPath,
    };
  }

  await logger.log("native-host", "daemon status check succeeded", state);
  return {
    ok: true,
    ...state,
    logPath,
  };
}

export function getDefaultRootDir(): string {
  return resolveBrowserAcpRootDir();
}

async function readState(statePath: string): Promise<DaemonState | undefined> {
  if (!existsSync(statePath)) {
    return undefined;
  }

  const raw = await readFile(statePath, "utf8");
  return JSON.parse(raw) as DaemonState;
}

async function defaultHealthCheck(state: DaemonState): Promise<boolean> {
  try {
    const response = await fetch(`${createDaemonBaseUrl(state.port)}/health`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function defaultStartDaemon(input: StartDaemonInput): Promise<{ pid: number }> {
  const daemonEntry = resolveDaemonEntry();
  const logFd = openSync(input.logPath, "a");
  const logger = createFileDebugLogger(input.logPath);
  await logger.log("native-host", "resolved daemon entry", daemonEntry);
  const shellEnv = await loadLoginShellEnvironment();
  await logger.log("native-host", "loaded login shell environment", {
    shell: shellEnv.SHELL ?? process.env.SHELL ?? "/bin/zsh",
    path: shellEnv.PATH,
  });
  const child = spawn(daemonEntry.command, daemonEntry.args.concat([
    "--port",
    String(input.port),
    "--token",
    input.token,
    "--rootDir",
    input.rootDir,
    "--cwd",
    input.defaultCwd,
  ]), {
    cwd: input.defaultCwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: buildDaemonEnvironment(process.env, shellEnv),
  });

  child.unref();
  await logger.log("native-host", "daemon child detached", {
    pid: child.pid ?? -1,
    port: input.port,
  });
  return {
    pid: child.pid ?? -1,
  };
}

export function buildDaemonEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...shellEnv,
    PATH: shellEnv.PATH ?? baseEnv.PATH,
    HOME: shellEnv.HOME ?? baseEnv.HOME,
    SHELL: shellEnv.SHELL ?? baseEnv.SHELL,
  };
}

export async function loadLoginShellEnvironment(
  shellPath = process.env.SHELL ?? "/bin/zsh",
  execFileImpl: (
    file: string,
    args: string[],
    options: {
      encoding: "utf8";
      maxBuffer: number;
    },
  ) => Promise<{ stdout: string; stderr: string }> = execFile,
): Promise<NodeJS.ProcessEnv> {
  if (!shellPath) {
    return {};
  }

  try {
    const result = await execFileImpl(shellPath, ["-lc", "env -0"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return parseShellEnvironment(result.stdout);
  } catch {
    return {};
  }
}

function resolveDaemonEntry(): { command: string; args: string[] } {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const daemonDist = resolve(currentDir, "../../acp-daemon/dist/index.js");
  if (existsSync(daemonDist)) {
    return {
      command: process.execPath,
      args: [daemonDist],
    };
  }

  const daemonSource = resolve(currentDir, "../../acp-daemon/src/index.ts");
  return {
    command: process.execPath,
    args: ["--import", "tsx", daemonSource],
  };
}

async function pickAvailablePort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server: Server = createServer();
    server.listen(0, DAEMON_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to pick a port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePromise(port);
      });
    });
    server.on("error", reject);
  });
}

function parseShellEnvironment(raw: string): NodeJS.ProcessEnv {
  const shellEnv: NodeJS.ProcessEnv = {};

  for (const entry of raw.split("\0")) {
    if (entry.length === 0) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex);
    const value = entry.slice(separatorIndex + 1);
    shellEnv[key] = value;
  }

  return shellEnv;
}

async function waitForDaemonReady(
  state: DaemonState,
  healthCheck: (state: DaemonState) => Promise<boolean>,
  sleep: (ms: number) => Promise<void>,
  logger: { log(scope: string, message: string, details?: unknown): Promise<void> },
): Promise<boolean> {
  for (let attempt = 0; attempt < DAEMON_READY_MAX_ATTEMPTS; attempt += 1) {
    if (await healthCheck(state)) {
      await logger.log("native-host", "daemon readiness check succeeded", {
        attempt: attempt + 1,
        port: state.port,
        pid: state.pid,
      });
      return true;
    }

    if (attempt === 0 || attempt === DAEMON_READY_MAX_ATTEMPTS - 1) {
      await logger.log("native-host", "daemon readiness check pending", {
        attempt: attempt + 1,
        port: state.port,
        pid: state.pid,
      });
    }
    await sleep(DAEMON_READY_RETRY_DELAY_MS);
  }

  return false;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
