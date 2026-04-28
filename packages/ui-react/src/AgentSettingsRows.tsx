import type { AgentSpec, AgentSpecCandidate, PageTaskTemplate } from "@browser-acp/shared-types";

export function ConfiguredAgentSpecRow({
  spec,
  disabled,
  iconSrc,
  onDelete,
}: {
  spec: AgentSpec;
  disabled: boolean;
  iconSrc?: string;
  onDelete: (agentId: string) => void;
}) {
  const command =
    spec.kind === "external-acp"
      ? [spec.launch.command, ...spec.launch.args].join(" ")
      : "Built-in agent";

  return (
    <div className="browser-acp-settings-agent-row">
      <div className="browser-acp-settings-agent-icon">
        {iconSrc ?? spec.icon?.value ? (
          <img src={iconSrc ?? spec.icon?.value} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{getAvatarLabel(spec.name)}</span>
        )}
      </div>
      <div className="browser-acp-settings-agent-copy">
        <strong>{spec.name}</strong>
        <code>{command}</code>
      </div>
      {spec.kind === "external-acp" ? (
        <button
          type="button"
          className="browser-acp-secondary-button"
          disabled={disabled}
          onClick={() => onDelete(spec.id)}
        >
          删除
        </button>
      ) : null}
    </div>
  );
}

export function AgentSpecCandidateRow({
  candidate,
  checked,
  disabled,
  iconSrc,
  onToggle,
}: {
  candidate: AgentSpecCandidate;
  checked: boolean;
  disabled: boolean;
  iconSrc?: string;
  onToggle: (candidateId: string, checked: boolean) => void;
}) {
  const command = [candidate.launchCommand, ...candidate.launchArgs].join(" ");

  return (
    <label className="browser-acp-settings-candidate-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(candidate.catalogId, event.target.checked)}
      />
      <span className="browser-acp-settings-agent-icon">
        {iconSrc ?? candidate.icon?.value ? (
          <img src={iconSrc ?? candidate.icon?.value} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{getAvatarLabel(candidate.name)}</span>
        )}
      </span>
      <span className="browser-acp-settings-agent-copy">
        <strong>
          {candidate.name}
          <em>{formatCandidateStatus(candidate.status)}</em>
        </strong>
        <code>{command}</code>
        {candidate.detectedCommandPath ? <small>{candidate.detectedCommandPath}</small> : null}
        {candidate.installationHint ? <small>{candidate.installationHint}</small> : null}
      </span>
    </label>
  );
}

export function PageTaskTemplateRow({
  template,
  disabled,
  onChange,
  onDelete,
}: {
  template: PageTaskTemplate;
  disabled: boolean;
  onChange: (templateId: string, patch: Partial<PageTaskTemplate>) => void;
  onDelete: (templateId: string) => void;
}) {
  return (
    <div className="browser-acp-settings-template-row">
      <div className="browser-acp-settings-template-main">
        <label className="browser-acp-settings-template-toggle">
          <input
            type="checkbox"
            checked={template.enabled}
            disabled={disabled}
            onChange={(event) => onChange(template.id, { enabled: event.target.checked })}
          />
          <span>在菜单中显示</span>
        </label>
        <label className="browser-acp-settings-field browser-acp-settings-template-title">
          <span>菜单标题</span>
          <input
            value={template.title}
            disabled={disabled}
            onChange={(event) => onChange(template.id, { title: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="browser-acp-secondary-button browser-acp-settings-template-delete"
          disabled={disabled}
          onClick={() => onDelete(template.id)}
        >
          删除
        </button>
      </div>
      <label className="browser-acp-settings-field browser-acp-settings-template-prompt">
        <span>发送给 AI 的内容</span>
        <textarea
          value={template.promptTemplate}
          disabled={disabled}
          onChange={(event) => onChange(template.id, { promptTemplate: event.target.value })}
        />
      </label>
    </div>
  );
}

function formatCandidateStatus(status: AgentSpecCandidate["status"]): string {
  switch (status) {
    case "ready":
      return "已安装";
    case "launchable":
      return "可启动";
    case "needs_adapter":
      return "需适配器";
    case "unavailable":
      return "不可用";
    default:
      return status;
  }
}

function getAvatarLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "A";
}
