import { describe, expect, it } from "vitest";
import { buildBuiltinAgentSpecCandidates } from "../src/agents/builtinCandidates.js";

describe("buildBuiltinAgentSpecCandidates", () => {
  it("converts discovered builtin ACP agents into external agent spec inputs", () => {
    const candidates = buildBuiltinAgentSpecCandidates({
      availableCommands: new Set(["gemini", "qodercli", "npx"]),
      commandPaths: new Map([
        ["gemini", "/shell/bin/gemini"],
        ["qodercli", "/Users/example/.local/bin/qodercli"],
        ["npx", "/usr/local/bin/npx"],
      ]),
      configuredSpecs: [],
    });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogId: "gemini-cli",
          name: "Gemini CLI",
          launchCommand: "gemini",
          launchArgs: ["--experimental-acp"],
          detectedCommandPath: "/shell/bin/gemini",
          status: "ready",
          recommended: true,
        }),
        expect.objectContaining({
          catalogId: "qoder-cli",
          name: "Qoder CLI",
          launchCommand: "qodercli",
          launchArgs: ["--acp"],
          status: "ready",
          recommended: true,
        }),
        expect.objectContaining({
          catalogId: "github-copilot-cli",
          launchCommand: "npx",
          launchArgs: ["@github/copilot", "--acp"],
          detectedCommandPath: "/usr/local/bin/npx",
          status: "launchable",
          recommended: true,
        }),
      ]),
    );
  });

  it("omits candidates that are already configured with the same launch command", () => {
    const candidates = buildBuiltinAgentSpecCandidates({
      availableCommands: new Set(["gemini", "npx"]),
      commandPaths: new Map([["gemini", "/shell/bin/gemini"]]),
      configuredSpecs: [
        {
          id: "external-gemini",
          name: "Gemini CLI",
          kind: "external-acp",
          enabled: true,
          launch: {
            command: "gemini",
            args: ["--experimental-acp"],
          },
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    });

    expect(candidates.find((candidate) => candidate.catalogId === "gemini-cli")).toBeUndefined();
  });
});
