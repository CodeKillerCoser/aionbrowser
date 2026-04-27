import type { ConversationSummary, ResolvedAgent } from "@browser-acp/shared-types";

export function ConversationSidebar({
  agents,
  sessions,
  selectedAgentId,
  selectedSessionId,
  collapsed,
  getAgentIconSrc,
  getAgentLocalPath,
  onOpenSettings,
  onSelectAgent,
  onSelectSession,
  onStartNewSession,
  onToggleCollapsed,
}: {
  agents: ResolvedAgent[];
  sessions: ConversationSummary[];
  selectedAgentId: string;
  selectedSessionId: string;
  collapsed: boolean;
  getAgentIconSrc: (agent: ResolvedAgent) => string | undefined;
  getAgentLocalPath: (agent: ResolvedAgent) => string;
  onOpenSettings: () => void;
  onSelectAgent: (agent: ResolvedAgent) => void;
  onSelectSession: (session: ConversationSummary) => void;
  onStartNewSession: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside className={`browser-acp-sidebar${collapsed ? " browser-acp-sidebar-collapsed" : ""}`}>
      <section className="browser-acp-sidebar-topbar">
        {!collapsed ? <h2>Agents</h2> : null}
        <button
          type="button"
          className="browser-acp-sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </section>

      <section>
        <div className={`browser-acp-agent-bar${collapsed ? " browser-acp-agent-bar-collapsed" : ""}`}>
          {agents.length > 0 ? (
            agents.map((agent) => {
              const localPath = getAgentLocalPath(agent);
              const iconSrc = getAgentIconSrc(agent);

              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`browser-acp-agent-icon-button${
                    selectedAgentId === agent.id ? " browser-acp-agent-icon-button-active" : ""
                  }`}
                  aria-pressed={selectedAgentId === agent.id}
                  aria-label={`${agent.name} ${agent.status}`}
                  title={`${agent.name}\n${localPath}`}
                  onClick={() => onSelectAgent(agent)}
                >
                  {iconSrc ? (
                    <img className="browser-acp-agent-icon-image" src={iconSrc} alt="" aria-hidden="true" />
                  ) : (
                    <span className="browser-acp-agent-icon-fallback" aria-hidden="true">
                      {getAvatarLabel(agent.name)}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="browser-acp-empty">还没有可用 Agent。</p>
          )}
        </div>
      </section>

      {!collapsed ? (
        <section className="browser-acp-sidebar-history">
          <div className="browser-acp-section-header browser-acp-section-header-history">
            <h2>对话历史</h2>
            <button type="button" className="browser-acp-secondary-button" onClick={onStartNewSession}>
              新建
            </button>
          </div>
          <div className="browser-acp-session-list">
            {sessions.length > 0 ? (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="browser-acp-session-item"
                  aria-pressed={selectedSessionId === session.id}
                  onClick={() => onSelectSession(session)}
                >
                  <span className="browser-acp-session-item-title">{session.title}</span>
                </button>
              ))
            ) : (
              <p className="browser-acp-empty">暂无对话。</p>
            )}
          </div>
          <button
            type="button"
            className="browser-acp-sidebar-settings-entry"
            aria-label="Agent settings"
            onClick={onOpenSettings}
          >
            <span aria-hidden="true">⌘</span>
            <span>Agent 设置</span>
          </button>
        </section>
      ) : (
        <button
          type="button"
          className="browser-acp-sidebar-settings-entry browser-acp-sidebar-settings-entry-collapsed"
          aria-label="Agent settings"
          title="Agent 设置"
          onClick={onOpenSettings}
        >
          <span aria-hidden="true">⌘</span>
        </button>
      )}
    </aside>
  );
}

function getAvatarLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "A";
}
