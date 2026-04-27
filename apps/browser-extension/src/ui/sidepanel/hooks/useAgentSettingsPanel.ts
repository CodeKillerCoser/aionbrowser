import { useEffect, useState } from "react";
import type { AgentIconSpec, AgentSpec, AgentSpecCandidate, ResolvedAgent } from "@browser-acp/shared-types";
import {
  buildCandidateAgentSpecInput,
  buildManualAgentSpecInput,
  buildUploadedAgentIcon,
  canSaveManualAgentSpec,
  collectRecommendedCandidateIds,
  getErrorMessage,
  getFirstCreatedAgentSpecId,
  getNextSelectedAgentIdAfterDelete,
  selectAgentSpecCandidates,
  toggleCandidateSelection,
} from "@browser-acp/client-core";
import type { BrowserAcpBridge } from "../../../host-api/agentConsoleHost";
import { resolveCandidateIcon, resolveSpecIcon } from "../agentIcons";
import { readFileAsDataUrl } from "../fileDataUrl";

export function useAgentSettingsPanel({
  bridge,
  visible,
  hostReady,
  agentSpecs,
  setAgentSpecs,
  setAgents,
  setSelectedAgentId,
  setError,
  recordPanelLog,
}: {
  bridge: BrowserAcpBridge;
  visible: boolean;
  hostReady: boolean;
  agentSpecs: AgentSpec[];
  setAgentSpecs: (value: AgentSpec[]) => void;
  setAgents: (value: ResolvedAgent[]) => void;
  setSelectedAgentId: (value: string | ((current: string) => string)) => void;
  setError: (value: string | null) => void;
  recordPanelLog: (message: string, details?: unknown, scope?: string) => void;
}) {
  const [settingsName, setSettingsName] = useState("");
  const [settingsCommand, setSettingsCommand] = useState("");
  const [settingsArgs, setSettingsArgs] = useState("");
  const [settingsIconUrl, setSettingsIconUrl] = useState("");
  const [settingsUploadedIcon, setSettingsUploadedIcon] = useState<AgentIconSpec | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [candidateScanBusy, setCandidateScanBusy] = useState(false);
  const [agentSpecCandidates, setAgentSpecCandidates] = useState<AgentSpecCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!visible || !hostReady) {
      return;
    }

    void refreshAgentSpecCandidates();
  }, [visible, hostReady]);

  async function refreshAgentSpecCandidates() {
    if (!hostReady) {
      return;
    }

    setCandidateScanBusy(true);
    try {
      const candidates = await bridge.listAgentSpecCandidates();
      setAgentSpecCandidates(candidates);
      setSelectedCandidateIds(collectRecommendedCandidateIds(candidates));
      recordPanelLog("agent spec candidates scanned", {
        count: candidates.length,
      });
    } catch (scanError) {
      const message = getErrorMessage(scanError);
      setError(message);
      recordPanelLog("agent spec candidate scan failed", {
        error: message,
      });
    } finally {
      setCandidateScanBusy(false);
    }
  }

  async function handleSaveAgentSpec() {
    if (!canSaveManualAgentSpec({ hostReady, settingsBusy, name: settingsName, launchCommand: settingsCommand })) {
      if (hostReady && !settingsBusy) {
        setError("Agent name and launch command are required.");
      }
      return;
    }

    const name = settingsName.trim();
    const launchCommand = settingsCommand.trim();

    setSettingsBusy(true);
    try {
      const created = await bridge.createAgentSpec(buildManualAgentSpecInput({
        name,
        launchCommand,
        launchArgsText: settingsArgs,
        iconUrl: settingsIconUrl,
        uploadedIcon: settingsUploadedIcon,
      }));
      const [nextSpecs, nextAgents] = await Promise.all([
        bridge.listAgentSpecs(),
        bridge.listAgents(),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      void refreshAgentSpecCandidates();
      setSelectedAgentId(created.id);
      setSettingsName("");
      setSettingsCommand("");
      setSettingsArgs("");
      setSettingsIconUrl("");
      setSettingsUploadedIcon(null);
      setError(null);
      recordPanelLog("external agent spec created", {
        agentId: created.id,
        name: created.name,
      });
    } catch (settingsError) {
      const message = getErrorMessage(settingsError);
      setError(message);
      recordPanelLog("external agent spec creation failed", {
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleDeleteAgentSpec(agentId: string) {
    if (!hostReady || settingsBusy) {
      return;
    }

    setSettingsBusy(true);
    try {
      await bridge.deleteAgentSpec(agentId);
      const [nextSpecs, nextAgents] = await Promise.all([
        bridge.listAgentSpecs(),
        bridge.listAgents(),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      void refreshAgentSpecCandidates();
      setSelectedAgentId((current) =>
        getNextSelectedAgentIdAfterDelete({
          selectedAgentId: current,
          deletedAgentId: agentId,
          nextAgents,
        }),
      );
      recordPanelLog("external agent spec deleted", {
        agentId,
      });
    } catch (deleteError) {
      const message = getErrorMessage(deleteError);
      setError(message);
      recordPanelLog("external agent spec deletion failed", {
        agentId,
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleIconUpload(file: File | undefined) {
    if (!file) {
      setSettingsUploadedIcon(null);
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setSettingsUploadedIcon(buildUploadedAgentIcon(dataUrl));
    setSettingsIconUrl("");
  }

  async function handleAddSelectedCandidates() {
    if (!hostReady || settingsBusy) {
      return;
    }

    const selectedCandidates = selectAgentSpecCandidates(agentSpecCandidates, selectedCandidateIds);
    if (selectedCandidates.length === 0) {
      return;
    }

    setSettingsBusy(true);
    try {
      const createdSpecs = [];
      for (const candidate of selectedCandidates) {
        createdSpecs.push(await bridge.createAgentSpec(buildCandidateAgentSpecInput(candidate)));
      }
      const [nextSpecs, nextAgents, nextCandidates] = await Promise.all([
        bridge.listAgentSpecs(),
        bridge.listAgents(),
        bridge.listAgentSpecCandidates(),
      ]);
      setAgentSpecs(nextSpecs);
      setAgents(nextAgents);
      setAgentSpecCandidates(nextCandidates);
      setSelectedCandidateIds(collectRecommendedCandidateIds(nextCandidates));
      const selectedCreatedAgentId = getFirstCreatedAgentSpecId(createdSpecs);
      if (selectedCreatedAgentId) {
        setSelectedAgentId(selectedCreatedAgentId);
      }
      setError(null);
      recordPanelLog("agent spec candidates added", {
        count: createdSpecs.length,
      });
    } catch (addError) {
      const message = getErrorMessage(addError);
      setError(message);
      recordPanelLog("agent spec candidate add failed", {
        error: message,
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  function handleToggleCandidate(candidateId: string, checked: boolean) {
    setSelectedCandidateIds((current) => toggleCandidateSelection(current, candidateId, checked));
  }

  function handleSettingsIconUrlChange(value: string) {
    setSettingsIconUrl(value);
    if (value.trim()) {
      setSettingsUploadedIcon(null);
    }
  }

  return {
    agentSpecCandidates,
    agentSpecs,
    candidateScanBusy,
    settingsBusy,
    selectedCandidateIds,
    settingsName,
    settingsCommand,
    settingsArgs,
    settingsIconUrl,
    getCandidateIconSrc: resolveCandidateIcon,
    getSpecIconSrc: resolveSpecIcon,
    onAddSelectedCandidates: () => void handleAddSelectedCandidates(),
    onDeleteAgentSpec: handleDeleteAgentSpec,
    onIconUpload: (file: File | undefined) => void handleIconUpload(file),
    onRefreshCandidates: () => void refreshAgentSpecCandidates(),
    onSaveAgentSpec: () => void handleSaveAgentSpec(),
    onSettingsArgsChange: setSettingsArgs,
    onSettingsCommandChange: setSettingsCommand,
    onSettingsIconUrlChange: handleSettingsIconUrlChange,
    onSettingsNameChange: setSettingsName,
    onToggleCandidate: handleToggleCandidate,
  };
}
