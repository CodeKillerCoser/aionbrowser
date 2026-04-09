import { describe, expect, it, vi } from "vitest";
import { scanAvailableCommands } from "../src/catalog/discovery.js";

describe("scanAvailableCommands", () => {
  it("uses which with the injected PATH to detect installed commands", async () => {
    const execFile = vi.fn(async (file: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      expect(file).toBe("which");
      expect(args).toEqual(["gemini"]);
      expect(options?.env?.PATH).toBe("/shell/bin:/usr/bin");

      return {
        stdout: "/shell/bin/gemini\n",
        stderr: "",
      };
    });

    const commands = await scanAvailableCommands(["gemini"], {
      env: {
        PATH: "/shell/bin:/usr/bin",
      },
      execFile,
    });

    expect(commands).toEqual(new Set(["gemini"]));
  });

  it("ignores commands that which cannot resolve", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("not found");
    });

    const commands = await scanAvailableCommands(["codex"], {
      env: {
        PATH: "/shell/bin:/usr/bin",
      },
      execFile,
    });

    expect(commands.size).toBe(0);
  });

  it("can resolve commands through the configured login shell", async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      expect(file).toBe("/bin/zsh");
      expect(args).toEqual(["-lc", "which qodercli"]);

      return {
        stdout: "/Users/example/.local/bin/qodercli\n",
        stderr: "",
      };
    });

    const commands = await scanAvailableCommands(["qodercli"], {
      shellPath: "/bin/zsh",
      execFile,
    });

    expect(commands).toEqual(new Set(["qodercli"]));
  });
});
