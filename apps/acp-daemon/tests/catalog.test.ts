import { describe, expect, it } from "vitest";
import type { AgentCatalogEntry } from "@browser-acp/shared-types";
import { buildResolvedCatalog } from "../src/catalog/index.js";

const registryEntries: AgentCatalogEntry[] = [
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's official CLI for Gemini",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@google/gemini-cli", "--experimental-acp"],
      packageName: "@google/gemini-cli"
    }
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "ACP adapter for OpenAI's coding assistant",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@zed-industries/codex-acp"],
      packageName: "@zed-industries/codex-acp"
    }
  },
  {
    id: "claude-agent",
    name: "Claude Agent",
    description: "ACP wrapper for Anthropic's Claude",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@agentclientprotocol/claude-agent-acp"],
      packageName: "@agentclientprotocol/claude-agent-acp"
    }
  },
  {
    id: "qoder-cli",
    name: "Qoder CLI",
    description: "ACP-aware coding agent",
    source: "registry",
    distribution: {
      type: "npx",
      command: "npx",
      args: ["@qoder-ai/qodercli", "--acp"],
      packageName: "@qoder-ai/qodercli"
    }
  }
];

describe("buildResolvedCatalog", () => {
  it("prefers user configuration over local scan and registry defaults", () => {
    const catalog = buildResolvedCatalog({
      registryEntries,
      userEntries: [
        {
          id: "gemini-cli",
          name: "Gemini CLI",
          source: "user",
          distribution: {
            type: "custom",
            command: "/opt/homebrew/bin/gemini",
            args: ["--acp"]
          }
        }
      ],
      availableCommands: new Set(["gemini", "npx"]),
    });

    const gemini = catalog.find((entry) => entry.id === "gemini-cli");

    expect(gemini).toMatchObject({
      source: "user",
      status: "ready",
      launchCommand: "/opt/homebrew/bin/gemini",
      launchArgs: ["--acp"],
    });
  });

  it("marks adapter-backed agents as needs_adapter when only the base cli is present", () => {
    const catalog = buildResolvedCatalog({
      registryEntries,
      userEntries: [],
      availableCommands: new Set(["codex", "claude", "npx"]),
    });

    expect(catalog.find((entry) => entry.id === "codex-cli")).toMatchObject({
      status: "needs_adapter",
      installationHint: expect.stringContaining("@zed-industries/codex-acp"),
    });

    expect(catalog.find((entry) => entry.id === "claude-agent")).toMatchObject({
      status: "needs_adapter",
      installationHint: expect.stringContaining("@agentclientprotocol/claude-agent-acp"),
    });
  });

  it("uses the CLI-specific ACP entrypoints for locally installed agents", () => {
    const catalog = buildResolvedCatalog({
      registryEntries,
      userEntries: [],
      availableCommands: new Set(["gemini", "qodercli", "npx"]),
    });

    expect(catalog.find((entry) => entry.id === "gemini-cli")).toMatchObject({
      status: "ready",
      launchCommand: "gemini",
      launchArgs: ["--experimental-acp"],
    });

    expect(catalog.find((entry) => entry.id === "qoder-cli")).toMatchObject({
      status: "ready",
      launchCommand: "qodercli",
      launchArgs: ["--acp"],
    });
  });

  it("does not treat the qoder desktop shell as an ACP-ready CLI", () => {
    const catalog = buildResolvedCatalog({
      registryEntries,
      userEntries: [],
      availableCommands: new Set(["qoder", "npx"]),
    });

    expect(catalog.find((entry) => entry.id === "qoder-cli")).toMatchObject({
      status: "launchable",
      launchCommand: "npx",
      launchArgs: ["@qoder-ai/qodercli", "--acp"],
    });
  });
});
