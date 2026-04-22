import { describe, expect, it, vi } from "vitest";
import { createBackgroundRouter } from "../src/background/router";

describe("background router", () => {
  it("delegates selection actions to the pending action service", async () => {
    const queueSelectionAction = vi.fn().mockResolvedValue({ ok: true });
    const router = createBackgroundRouter({
      updateContextFromPage: vi.fn(),
      ensureDaemon: vi.fn(),
      listAgents: vi.fn(),
      listAgentSpecs: vi.fn(),
      listAgentSpecCandidates: vi.fn(),
      createAgentSpec: vi.fn(),
      updateAgentSpec: vi.fn(),
      deleteAgentSpec: vi.fn(),
      listSessions: vi.fn(),
      getActiveContext: vi.fn(),
      getDebugState: vi.fn(),
      createSession: vi.fn(),
      queueSelectionAction,
      claimPendingSelectionAction: vi.fn(),
    });

    const result = await router.handle(
      {
        type: "browser-acp/trigger-selection-action",
        action: "explain",
        selectionText: "Alpha",
      },
      {
        tab: {
          id: 7,
          windowId: 3,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
    );

    expect(queueSelectionAction).toHaveBeenCalledWith("explain", "Alpha", {
      tabId: 7,
      windowId: 3,
    });
    expect(result).toEqual({ ok: true });
  });

  it("routes external agent settings requests", async () => {
    const createAgentSpec = vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "Custom Agent",
    });
    const listAgentSpecCandidates = vi.fn().mockResolvedValue([
      {
        catalogId: "gemini-cli",
        name: "Gemini CLI",
        launchCommand: "gemini",
        launchArgs: ["--experimental-acp"],
      },
    ]);
    const updateAgentSpec = vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "Updated Agent",
    });
    const deleteAgentSpec = vi.fn().mockResolvedValue({ ok: true });
    const router = createBackgroundRouter({
      updateContextFromPage: vi.fn(),
      ensureDaemon: vi.fn(),
      listAgents: vi.fn(),
      listAgentSpecs: vi.fn().mockResolvedValue([]),
      listAgentSpecCandidates,
      createAgentSpec,
      updateAgentSpec,
      deleteAgentSpec,
      listSessions: vi.fn(),
      getActiveContext: vi.fn(),
      getDebugState: vi.fn(),
      createSession: vi.fn(),
      queueSelectionAction: vi.fn(),
      claimPendingSelectionAction: vi.fn(),
    });

    await router.handle(
      {
        type: "browser-acp/list-agent-spec-candidates",
      },
      {} as chrome.runtime.MessageSender,
    );
    await router.handle(
      {
        type: "browser-acp/create-agent-spec",
        input: {
          name: "Custom Agent",
          launchCommand: "custom-agent",
          launchArgs: ["--acp"],
        },
      },
      {} as chrome.runtime.MessageSender,
    );
    await router.handle(
      {
        type: "browser-acp/update-agent-spec",
        id: "agent-1",
        patch: {
          name: "Updated Agent",
        },
      },
      {} as chrome.runtime.MessageSender,
    );
    const deleted = await router.handle(
      {
        type: "browser-acp/delete-agent-spec",
        id: "agent-1",
      },
      {} as chrome.runtime.MessageSender,
    );

    expect(listAgentSpecCandidates).toHaveBeenCalled();
    expect(createAgentSpec).toHaveBeenCalledWith({
      name: "Custom Agent",
      launchCommand: "custom-agent",
      launchArgs: ["--acp"],
    });
    expect(updateAgentSpec).toHaveBeenCalledWith("agent-1", {
      name: "Updated Agent",
    });
    expect(deleteAgentSpec).toHaveBeenCalledWith("agent-1");
    expect(deleted).toEqual({ ok: true });
  });
});
