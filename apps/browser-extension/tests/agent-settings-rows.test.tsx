import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSpec, AgentSpecCandidate } from "@browser-acp/shared-types";
import { AgentSettingsPage, AgentSpecCandidateRow, ConfiguredAgentSpecRow } from "@browser-acp/ui-react";

describe("agent settings rows", () => {
  it("renders configured external ACP agents and reports delete actions", () => {
    const onDelete = vi.fn();
    const spec: AgentSpec = {
      id: "custom-agent",
      name: "Custom Agent",
      kind: "external-acp",
      enabled: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
      launch: {
        command: "/usr/local/bin/custom-agent",
        args: ["--acp", "--profile", "dev"],
      },
    };

    render(<ConfiguredAgentSpecRow spec={spec} disabled={false} onDelete={onDelete} />);

    expect(screen.getByText("Custom Agent")).toBeInTheDocument();
    expect(screen.getByText("/usr/local/bin/custom-agent --acp --profile dev")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(onDelete).toHaveBeenCalledWith("custom-agent");
  });

  it("renders detected candidates and reports checked state changes", () => {
    const onToggle = vi.fn();
    const candidate: AgentSpecCandidate = {
      catalogId: "qoder-cli",
      name: "Qoder CLI",
      launchCommand: "qoder",
      launchArgs: ["--acp"],
      detectedCommandPath: "/opt/qoder/bin/qoder",
      status: "ready",
      recommended: true,
    };

    render(
      <AgentSpecCandidateRow
        candidate={candidate}
        checked={false}
        disabled={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("Qoder CLI")).toBeInTheDocument();
    expect(screen.getByText("已安装")).toBeInTheDocument();
    expect(screen.getByText("qoder --acp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));

    expect(onToggle).toHaveBeenCalledWith("qoder-cli", true);
  });

  it("renders the settings page actions with host-provided callbacks", () => {
    const onBack = vi.fn();
    const onRefreshCandidates = vi.fn();
    const onSaveAgentSpec = vi.fn();
    const onAddSelectedCandidates = vi.fn();

    render(
      <AgentSettingsPage
        agentSpecCandidates={[]}
        agentSpecs={[]}
        candidateScanBusy={false}
        settingsBusy={false}
        selectedCandidateIds={new Set(["qoder-cli"])}
        settingsName="Qoder"
        settingsCommand="qoder"
        settingsArgs="--acp"
        settingsIconUrl=""
        onAddSelectedCandidates={onAddSelectedCandidates}
        onBack={onBack}
        onDeleteAgentSpec={vi.fn()}
        onIconUpload={vi.fn()}
        onRefreshCandidates={onRefreshCandidates}
        onSaveAgentSpec={onSaveAgentSpec}
        onSettingsArgsChange={vi.fn()}
        onSettingsCommandChange={vi.fn()}
        onSettingsIconUrlChange={vi.fn()}
        onSettingsNameChange={vi.fn()}
        onToggleCandidate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefreshCandidates).toHaveBeenCalledOnce();
    expect(onSaveAgentSpec).toHaveBeenCalledOnce();
    expect(screen.getByText("没有发现新的可添加 Agent。")).toBeInTheDocument();
  });
});
