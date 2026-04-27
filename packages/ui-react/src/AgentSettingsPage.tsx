import type { AgentSpec, AgentSpecCandidate } from "@browser-acp/shared-types";
import { AgentSpecCandidateRow, ConfiguredAgentSpecRow } from "./AgentSettingsRows";

export function AgentSettingsPage({
  agentSpecCandidates,
  agentSpecs,
  candidateScanBusy,
  settingsBusy,
  selectedCandidateIds,
  settingsName,
  settingsCommand,
  settingsArgs,
  settingsIconUrl,
  getCandidateIconSrc,
  getSpecIconSrc,
  onAddSelectedCandidates,
  onBack,
  onDeleteAgentSpec,
  onIconUpload,
  onRefreshCandidates,
  onSaveAgentSpec,
  onSettingsArgsChange,
  onSettingsCommandChange,
  onSettingsIconUrlChange,
  onSettingsNameChange,
  onToggleCandidate,
}: {
  agentSpecCandidates: AgentSpecCandidate[];
  agentSpecs: AgentSpec[];
  candidateScanBusy: boolean;
  settingsBusy: boolean;
  selectedCandidateIds: Set<string>;
  settingsName: string;
  settingsCommand: string;
  settingsArgs: string;
  settingsIconUrl: string;
  getCandidateIconSrc?: (candidate: AgentSpecCandidate) => string | undefined;
  getSpecIconSrc?: (spec: AgentSpec) => string | undefined;
  onAddSelectedCandidates: () => void;
  onBack: () => void;
  onDeleteAgentSpec: (agentId: string) => void;
  onIconUpload: (file: File | undefined) => void;
  onRefreshCandidates: () => void;
  onSaveAgentSpec: () => void;
  onSettingsArgsChange: (value: string) => void;
  onSettingsCommandChange: (value: string) => void;
  onSettingsIconUrlChange: (value: string) => void;
  onSettingsNameChange: (value: string) => void;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  return (
    <div className="browser-acp-settings-page">
      <aside className="browser-acp-settings-nav" aria-label="Settings navigation">
        <button
          type="button"
          className="browser-acp-settings-back"
          aria-label="返回对话"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span>
          <span>返回对话</span>
        </button>
        <nav className="browser-acp-settings-nav-list">
          <button type="button" className="browser-acp-settings-nav-item browser-acp-settings-nav-item-active">
            <span aria-hidden="true">⌘</span>
            <span>Agent 配置</span>
          </button>
          <button type="button" className="browser-acp-settings-nav-item" disabled>
            <span aria-hidden="true">◌</span>
            <span>外观</span>
          </button>
          <button type="button" className="browser-acp-settings-nav-item" disabled>
            <span aria-hidden="true">⎇</span>
            <span>快捷操作</span>
          </button>
        </nav>
      </aside>

      <main className="browser-acp-settings-content">
        <section className="browser-acp-settings-panel" aria-label="Agent settings panel">
          <div className="browser-acp-settings-hero">
            <h1>Agent 配置</h1>
          </div>

          <div className="browser-acp-settings-card browser-acp-settings-list">
            <div className="browser-acp-settings-list-header">
              <div>
                <h3>检测到可添加的 Agent</h3>
                <p>自动识别常见后端，并展示本机启动路径。</p>
              </div>
              <button
                type="button"
                className="browser-acp-secondary-button"
                disabled={candidateScanBusy || settingsBusy}
                onClick={onRefreshCandidates}
              >
                {candidateScanBusy ? "扫描中" : "重新扫描"}
              </button>
            </div>
            {agentSpecCandidates.length > 0 ? (
              <>
                {agentSpecCandidates.map((candidate) => (
                  <AgentSpecCandidateRow
                    key={candidate.catalogId}
                    candidate={candidate}
                    checked={selectedCandidateIds.has(candidate.catalogId)}
                    disabled={settingsBusy}
                    iconSrc={getCandidateIconSrc?.(candidate)}
                    onToggle={onToggleCandidate}
                  />
                ))}
                <button
                  type="button"
                  className="browser-acp-composer-send browser-acp-settings-add-candidates"
                  disabled={settingsBusy || selectedCandidateIds.size === 0}
                  onClick={onAddSelectedCandidates}
                >
                  添加选中项
                </button>
              </>
            ) : (
              <p className="browser-acp-empty">
                {candidateScanBusy ? "正在扫描本机可用 Agent..." : "没有发现新的可添加 Agent。"}
              </p>
            )}
          </div>

          <div className="browser-acp-settings-card">
            <div className="browser-acp-settings-section-header">
              <h3>手动添加</h3>
              <p>接入扫描规则之外的外部 ACP agent。</p>
            </div>
            <div className="browser-acp-settings-grid">
              <label className="browser-acp-settings-field">
                <span>Agent name</span>
                <input
                  value={settingsName}
                  onChange={(event) => onSettingsNameChange(event.target.value)}
                  placeholder="My ACP Agent"
                />
              </label>
              <label className="browser-acp-settings-field">
                <span>Launch command</span>
                <input
                  value={settingsCommand}
                  onChange={(event) => onSettingsCommandChange(event.target.value)}
                  placeholder="/usr/local/bin/my-agent"
                />
              </label>
              <label className="browser-acp-settings-field">
                <span>Launch arguments</span>
                <input
                  value={settingsArgs}
                  onChange={(event) => onSettingsArgsChange(event.target.value)}
                  placeholder="--acp --profile dev"
                />
              </label>
              <label className="browser-acp-settings-field">
                <span>Icon URL</span>
                <input
                  value={settingsIconUrl}
                  onChange={(event) => onSettingsIconUrlChange(event.target.value)}
                  placeholder="https://example.com/icon.svg"
                />
              </label>
              <label className="browser-acp-settings-field">
                <span>Upload icon</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => onIconUpload(event.target.files?.[0])}
                />
              </label>
            </div>
            <div className="browser-acp-settings-actions">
              <button
                type="button"
                className="browser-acp-composer-send"
                disabled={settingsBusy || !settingsName.trim() || !settingsCommand.trim()}
                onClick={onSaveAgentSpec}
              >
                保存 Agent
              </button>
            </div>
          </div>

          <div className="browser-acp-settings-card browser-acp-settings-list">
            <div className="browser-acp-settings-section-header">
              <h3>已配置</h3>
              <p>这些 Agent 会出现在对话侧栏中。</p>
            </div>
            {agentSpecs.length > 0 ? (
              agentSpecs.map((spec) => (
                <ConfiguredAgentSpecRow
                  key={spec.id}
                  spec={spec}
                  disabled={settingsBusy}
                  iconSrc={getSpecIconSrc?.(spec)}
                  onDelete={onDeleteAgentSpec}
                />
              ))
            ) : (
              <p className="browser-acp-empty">还没有配置外部 Agent。</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
