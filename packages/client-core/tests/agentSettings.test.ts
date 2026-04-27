import { describe, expect, it } from "vitest";
import {
  buildCandidateAgentSpecInput,
  buildManualAgentSpecInput,
  buildUploadedAgentIcon,
  canSaveManualAgentSpec,
  collectRecommendedCandidateIds,
  formatAgentLocalPath,
  getFirstCreatedAgentSpecId,
  getNextSelectedAgentIdAfterDelete,
  parseLaunchArgs,
  selectAgentSpecCandidates,
  toggleCandidateSelection,
} from "../src/index.js";

describe("parseLaunchArgs", () => {
  it("splits launch args on whitespace and removes empty tokens", () => {
    expect(parseLaunchArgs("  --acp   --profile dev  ")).toEqual(["--acp", "--profile", "dev"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseLaunchArgs("   ")).toEqual([]);
  });

  it("formats detected local paths and command fallbacks", () => {
    expect(
      formatAgentLocalPath({
        detectedCommand: "/opt/qoder/bin/qoder",
        launchCommand: "qoder",
        launchArgs: ["--acp"],
      }),
    ).toBe("Local path: /opt/qoder/bin/qoder --acp");

    expect(
      formatAgentLocalPath({
        launchCommand: "qoder",
        launchArgs: ["--acp"],
      }),
    ).toBe("Command: qoder --acp");
  });

  it("builds a trimmed manual external agent spec input", () => {
    expect(
      buildManualAgentSpecInput({
        name: "  Local Agent  ",
        launchCommand: "  /opt/bin/agent  ",
        launchArgsText: " --acp   --profile dev ",
        iconUrl: " https://example.com/icon.svg ",
        uploadedIcon: null,
      }),
    ).toEqual({
      name: "Local Agent",
      launchCommand: "/opt/bin/agent",
      launchArgs: ["--acp", "--profile", "dev"],
      icon: { kind: "url", value: "https://example.com/icon.svg" },
    });
  });

  it("checks whether a manual agent spec can be saved", () => {
    expect(canSaveManualAgentSpec({ hostReady: true, settingsBusy: false, name: " Agent ", launchCommand: " agent " })).toBe(true);
    expect(canSaveManualAgentSpec({ hostReady: false, settingsBusy: false, name: "Agent", launchCommand: "agent" })).toBe(false);
    expect(canSaveManualAgentSpec({ hostReady: true, settingsBusy: true, name: "Agent", launchCommand: "agent" })).toBe(false);
    expect(canSaveManualAgentSpec({ hostReady: true, settingsBusy: false, name: " ", launchCommand: "agent" })).toBe(false);
    expect(canSaveManualAgentSpec({ hostReady: true, settingsBusy: false, name: "Agent", launchCommand: " " })).toBe(false);
  });

  it("prefers uploaded manual icons over icon URLs", () => {
    expect(
      buildManualAgentSpecInput({
        name: "Agent",
        launchCommand: "agent",
        launchArgsText: "",
        iconUrl: "https://example.com/icon.svg",
        uploadedIcon: { kind: "uploaded", value: "data:image/svg+xml;base64,abc" },
      }),
    ).toEqual({
      name: "Agent",
      launchCommand: "agent",
      launchArgs: [],
      icon: { kind: "uploaded", value: "data:image/svg+xml;base64,abc" },
    });
  });

  it("maps scanned candidates to external agent spec inputs", () => {
    expect(
      buildCandidateAgentSpecInput({
        catalogId: "qoder-cli",
        name: "Qoder",
        description: "Qoder CLI",
        icon: { kind: "url", value: "https://example.com/qoder.svg" },
        launchCommand: "qoder",
        launchArgs: ["--acp"],
        status: "ready",
        recommended: true,
      }),
    ).toEqual({
      name: "Qoder",
      launchCommand: "qoder",
      launchArgs: ["--acp"],
      description: "Qoder CLI",
      icon: { kind: "url", value: "https://example.com/qoder.svg" },
    });
  });

  it("builds uploaded icon specs from data URLs", () => {
    expect(buildUploadedAgentIcon("data:image/png;base64,abc")).toEqual({
      kind: "uploaded",
      value: "data:image/png;base64,abc",
    });
  });

  it("collects recommended candidate ids and filters selected candidates in list order", () => {
    const candidates = [
      {
        catalogId: "codex-cli",
        name: "Codex",
        launchCommand: "codex",
        launchArgs: [],
        status: "ready" as const,
        recommended: false,
      },
      {
        catalogId: "qoder-cli",
        name: "Qoder",
        launchCommand: "qoder",
        launchArgs: [],
        status: "ready" as const,
        recommended: true,
      },
    ];

    expect(collectRecommendedCandidateIds(candidates)).toEqual(new Set(["qoder-cli"]));
    expect(selectAgentSpecCandidates(candidates, new Set(["qoder-cli", "missing"]))).toEqual([candidates[1]]);
  });

  it("toggles selected candidate ids without mutating the current set", () => {
    const current = new Set(["codex-cli"]);

    const added = toggleCandidateSelection(current, "qoder-cli", true);
    const removed = toggleCandidateSelection(current, "codex-cli", false);

    expect(added).toEqual(new Set(["codex-cli", "qoder-cli"]));
    expect(removed).toEqual(new Set());
    expect(current).toEqual(new Set(["codex-cli"]));
  });

  it("selects the first created spec id after adding candidates", () => {
    expect(getFirstCreatedAgentSpecId([{ id: "agent-1" }, { id: "agent-2" }])).toBe("agent-1");
    expect(getFirstCreatedAgentSpecId([])).toBe("");
  });

  it("keeps current selection unless the selected agent was deleted", () => {
    expect(
      getNextSelectedAgentIdAfterDelete({
        selectedAgentId: "agent-1",
        deletedAgentId: "agent-2",
        nextAgents: [{ id: "agent-3" }],
      }),
    ).toBe("agent-1");

    expect(
      getNextSelectedAgentIdAfterDelete({
        selectedAgentId: "agent-1",
        deletedAgentId: "agent-1",
        nextAgents: [{ id: "agent-3" }],
      }),
    ).toBe("agent-3");
  });
});
