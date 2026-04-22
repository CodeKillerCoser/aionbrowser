import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { DebugLogger } from "../debug/logger.js";

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface CommandDiscoveryResult {
  commands: Set<string>;
  commandPaths: Map<string, string>;
}

interface ScanAvailableCommandsOptions {
  env?: NodeJS.ProcessEnv;
  shellPath?: string;
  logger?: DebugLogger;
  execFile?: (
    file: string,
    args: string[],
    options: {
      env?: NodeJS.ProcessEnv;
      encoding: "utf8";
      maxBuffer: number;
    },
  ) => Promise<ExecFileResult>;
}

const execFile = promisify(execFileCallback);

export async function scanAvailableCommands(
  candidateCommands: string[],
  options: ScanAvailableCommandsOptions = {},
): Promise<CommandDiscoveryResult> {
  const commands = new Set<string>();
  const commandPaths = new Map<string, string>();
  const exec = options.execFile ?? execFile;
  const env = options.env ?? process.env;
  const logger = options.logger;
  const shellPath = options.shellPath;
  const candidates = [...new Set(candidateCommands.filter((entry) => entry.length > 0))];
  logger?.log("catalog", "running command discovery via which", {
    candidates,
  });

  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const result = shellPath
          ? await exec(shellPath, ["-lc", `which ${candidate}`], {
              env,
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
            })
          : await exec("which", [candidate], {
              env,
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
        });
        const commandPath = result.stdout.trim().split(/\r?\n/).find(Boolean);
        if (commandPath) {
          commands.add(candidate);
          commandPaths.set(candidate, commandPath);
        }
      } catch (error) {
        logger?.log("catalog", "command discovery candidate not found", {
          candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  logger?.log("catalog", "command discovery via which completed", {
    detected: [...commands],
  });

  return {
    commands,
    commandPaths,
  };
}
