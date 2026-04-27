import { describe, expect, it } from "vitest";
import type { AgentSpec, AgentSpecCandidate, ResolvedAgent } from "@browser-acp/shared-types";
import { resolveAgentIcon, resolveCandidateIcon, resolveSpecIcon } from "../src/ui/sidepanel/agentIcons";

describe("agent icon resolution", () => {
  it("prefers explicit agent icons over built-in matches", () => {
    const agent: ResolvedAgent = {
      id: "codex-cli",
      name: "Codex",
      icon: "https://example.com/icon.svg",
      source: "registry",
      distribution: { type: "binary", command: "codex" },
      status: "ready",
      launchCommand: "codex",
      launchArgs: [],
    };

    expect(resolveAgentIcon(agent)).toBe("https://example.com/icon.svg");
  });

  it("uses built-in catalog ids and command matches as fallbacks", () => {
    const catalogAgent: ResolvedAgent = {
      id: "qoder-cli",
      name: "Qoder",
      source: "registry",
      distribution: { type: "binary", command: "qoder" },
      status: "ready",
      launchCommand: "qoder",
      launchArgs: [],
    };
    const commandCandidate: AgentSpecCandidate = {
      catalogId: "custom-gemini",
      name: "Local model",
      launchCommand: "npx @google/gemini-cli",
      launchArgs: [],
      status: "ready",
      recommended: false,
    };

    expect(resolveAgentIcon(catalogAgent)).toBeTruthy();
    expect(resolveCandidateIcon(commandCandidate)).toBeTruthy();
  });

  it("resolves configured spec icons before external ACP command matches", () => {
    const spec: AgentSpec = {
      id: "custom-claude",
      name: "Claude via wrapper",
      kind: "external-acp",
      enabled: true,
      icon: { kind: "url", value: "https://example.com/claude.svg" },
      launch: { command: "/opt/bin/claude-wrapper", args: [] },
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };

    expect(resolveSpecIcon(spec)).toBe("https://example.com/claude.svg");
  });
});
