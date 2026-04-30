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
      listPageTaskTemplates: vi.fn(),
      updatePageTaskTemplates: vi.fn(),
      listContextHistory: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      getAgentModels: vi.fn(),
      getAgentAuthStatus: vi.fn(),
      authenticateAgent: vi.fn(),
      getSessionModels: vi.fn(),
      setSessionModel: vi.fn(),
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
      listPageTaskTemplates: vi.fn(),
      updatePageTaskTemplates: vi.fn(),
      listContextHistory: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      getAgentModels: vi.fn(),
      getAgentAuthStatus: vi.fn(),
      authenticateAgent: vi.fn(),
      getSessionModels: vi.fn(),
      setSessionModel: vi.fn(),
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

  it("routes session rename and delete requests", async () => {
    const renameSession = vi.fn().mockResolvedValue({
      id: "session-1",
      title: "Renamed",
    });
    const deleteSession = vi.fn().mockResolvedValue({ ok: true });
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
      listPageTaskTemplates: vi.fn(),
      updatePageTaskTemplates: vi.fn(),
      listContextHistory: vi.fn(),
      createSession: vi.fn(),
      renameSession,
      deleteSession,
      getAgentModels: vi.fn(),
      getAgentAuthStatus: vi.fn(),
      authenticateAgent: vi.fn(),
      getSessionModels: vi.fn(),
      setSessionModel: vi.fn(),
      queueSelectionAction: vi.fn(),
      claimPendingSelectionAction: vi.fn(),
    });

    await router.handle(
      {
        type: "browser-acp/rename-session",
        sessionId: "session-1",
        title: "Renamed",
      },
      {} as chrome.runtime.MessageSender,
    );
    const deleted = await router.handle(
      {
        type: "browser-acp/delete-session",
        sessionId: "session-1",
      },
      {} as chrome.runtime.MessageSender,
    );

    expect(renameSession).toHaveBeenCalledWith("session-1", "Renamed");
    expect(deleteSession).toHaveBeenCalledWith("session-1");
    expect(deleted).toEqual({ ok: true });
  });

  it("routes page task template and context history requests", async () => {
    const listPageTaskTemplates = vi.fn().mockResolvedValue([
      {
        id: "explain",
        title: "解释",
        promptTemplate: "解释 {{selectionText}}",
        enabled: true,
      },
    ]);
    const updatePageTaskTemplates = vi.fn().mockResolvedValue({ ok: true });
    const listContextHistory = vi.fn().mockResolvedValue([
      {
        id: "ctx-1",
        reason: "tabs.onActivated",
        capturedAt: "2026-04-27T00:00:00.000Z",
        context: {
          tabId: 1,
          title: "Example",
          url: "https://example.com",
          selectionText: "",
          summaryMarkdown: "",
          openTabsPreview: [],
          capturedAt: "2026-04-27T00:00:00.000Z",
        },
      },
    ]);
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
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      getAgentModels: vi.fn(),
      getAgentAuthStatus: vi.fn(),
      authenticateAgent: vi.fn(),
      getSessionModels: vi.fn(),
      setSessionModel: vi.fn(),
      queueSelectionAction: vi.fn(),
      claimPendingSelectionAction: vi.fn(),
      listPageTaskTemplates,
      updatePageTaskTemplates,
      listContextHistory,
    });

    expect(await router.handle({ type: "browser-acp/list-page-task-templates" }, {} as chrome.runtime.MessageSender))
      .toHaveLength(1);
    expect(await router.handle({
      type: "browser-acp/update-page-task-templates",
      templates: [
        {
          id: "custom",
          title: "自定义",
          promptTemplate: "处理 {{pageTitle}}",
          enabled: true,
        },
      ],
    }, {} as chrome.runtime.MessageSender)).toEqual({ ok: true });
    expect(await router.handle({ type: "browser-acp/list-context-history" }, {} as chrome.runtime.MessageSender))
      .toHaveLength(1);

    expect(listPageTaskTemplates).toHaveBeenCalledOnce();
    expect(updatePageTaskTemplates).toHaveBeenCalledWith([
      {
        id: "custom",
        title: "自定义",
        promptTemplate: "处理 {{pageTitle}}",
        enabled: true,
      },
    ]);
    expect(listContextHistory).toHaveBeenCalledOnce();
  });
});
