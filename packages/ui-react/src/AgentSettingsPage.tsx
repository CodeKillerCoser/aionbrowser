import type { AgentSpec, AgentSpecCandidate, PageTaskTemplate } from "@browser-acp/shared-types";
import { useState } from "react";
import { AgentSpecCandidateRow, ConfiguredAgentSpecRow, PageTaskTemplateRow } from "./AgentSettingsRows";

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
  pageTaskTemplates,
  pageTaskSettingsBusy,
  getCandidateIconSrc,
  getSpecIconSrc,
  onAddSelectedCandidates,
  onBack,
  onDeleteAgentSpec,
  onIconUpload,
  onPageTaskTemplateAdd,
  onPageTaskTemplateChange,
  onPageTaskTemplateDelete,
  onPageTaskTemplatesReset,
  onPageTaskTemplatesSave,
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
  pageTaskTemplates: PageTaskTemplate[];
  pageTaskSettingsBusy: boolean;
  getCandidateIconSrc?: (candidate: AgentSpecCandidate) => string | undefined;
  getSpecIconSrc?: (spec: AgentSpec) => string | undefined;
  onAddSelectedCandidates: () => void;
  onBack: () => void;
  onDeleteAgentSpec: (agentId: string) => void;
  onIconUpload: (file: File | undefined) => void;
  onPageTaskTemplateAdd: () => void;
  onPageTaskTemplateChange: (templateId: string, patch: Partial<PageTaskTemplate>) => void;
  onPageTaskTemplateDelete: (templateId: string) => void;
  onPageTaskTemplatesReset: () => void;
  onPageTaskTemplatesSave: () => void;
  onRefreshCandidates: () => void;
  onSaveAgentSpec: () => void;
  onSettingsArgsChange: (value: string) => void;
  onSettingsCommandChange: (value: string) => void;
  onSettingsIconUrlChange: (value: string) => void;
  onSettingsNameChange: (value: string) => void;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  const [activeSection, setActiveSection] = useState<"agents" | "page-tasks">("agents");

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
          <button
            type="button"
            className={`browser-acp-settings-nav-item${activeSection === "agents" ? " browser-acp-settings-nav-item-active" : ""}`}
            aria-pressed={activeSection === "agents"}
            onClick={() => setActiveSection("agents")}
          >
            <span aria-hidden="true">AG</span>
            <span>Agent 配置</span>
          </button>
          <button
            type="button"
            className={`browser-acp-settings-nav-item${activeSection === "page-tasks" ? " browser-acp-settings-nav-item-active" : ""}`}
            aria-pressed={activeSection === "page-tasks"}
            onClick={() => setActiveSection("page-tasks")}
          >
            <span aria-hidden="true">PT</span>
            <span>页面任务</span>
          </button>
        </nav>
      </aside>

      <main className="browser-acp-settings-content">
        {activeSection === "agents" ? (
          <section className="browser-acp-settings-panel" aria-label="Agent settings panel">
            <div className="browser-acp-settings-hero">
              <h1>Agent 配置</h1>
              <span>管理可在侧栏中启动的本机 Agent。</span>
            </div>

            <div className="browser-acp-settings-card browser-acp-settings-list">
              <div className="browser-acp-settings-list-header">
                <div>
                  <h3>可添加的 Agent</h3>
                  <p>从本机环境中识别可启动的 ACP 后端。</p>
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
                <p>接入扫描规则之外的外部 ACP Agent。</p>
              </div>
              <div className="browser-acp-settings-grid">
                <label className="browser-acp-settings-field">
                  <span>名称</span>
                  <input
                    value={settingsName}
                    onChange={(event) => onSettingsNameChange(event.target.value)}
                    placeholder="My ACP Agent"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>启动命令</span>
                  <input
                    value={settingsCommand}
                    onChange={(event) => onSettingsCommandChange(event.target.value)}
                    placeholder="/usr/local/bin/my-agent"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>启动参数</span>
                  <input
                    value={settingsArgs}
                    onChange={(event) => onSettingsArgsChange(event.target.value)}
                    placeholder="--acp --profile dev"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>图标 URL</span>
                  <input
                    value={settingsIconUrl}
                    onChange={(event) => onSettingsIconUrlChange(event.target.value)}
                    placeholder="https://example.com/icon.svg"
                  />
                </label>
                <label className="browser-acp-settings-field">
                  <span>上传图标</span>
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
        ) : (
          <section className="browser-acp-settings-panel" aria-label="Page task settings panel">
            <div className="browser-acp-settings-hero">
              <h1>页面任务模板</h1>
              <span>配置页面划词后出现的菜单项，以及点击后发送给 AI 的内容。</span>
            </div>

            <div className="browser-acp-settings-card browser-acp-settings-list">
              <div className="browser-acp-settings-list-header">
                <div>
                  <h3>菜单项</h3>
                  <p>标题用于页面菜单；内容支持变量，如 {"{{selectionText}}"}、{"{{pageTitle}}"}、{"{{pageUrl}}"}。</p>
                </div>
                <div className="browser-acp-settings-actions-inline">
                  <button
                    type="button"
                    className="browser-acp-secondary-button"
                    disabled={pageTaskSettingsBusy}
                    onClick={onPageTaskTemplateAdd}
                  >
                    新增模板
                  </button>
                  <button
                    type="button"
                    className="browser-acp-secondary-button"
                    disabled={pageTaskSettingsBusy}
                    onClick={onPageTaskTemplatesReset}
                  >
                    恢复默认
                  </button>
                  <button
                    type="button"
                    className="browser-acp-composer-send"
                    disabled={pageTaskSettingsBusy}
                    onClick={onPageTaskTemplatesSave}
                  >
                    保存更改
                  </button>
                </div>
              </div>
              {pageTaskTemplates.map((template) => (
                <PageTaskTemplateRow
                  key={template.id}
                  template={template}
                  disabled={pageTaskSettingsBusy}
                  onChange={onPageTaskTemplateChange}
                  onDelete={onPageTaskTemplateDelete}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
