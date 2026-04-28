import { useEffect, useRef, useState } from "react";
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
  onRenameSession,
  onDeleteSession,
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
  onRenameSession: (session: ConversationSummary, title: string) => Promise<void> | void;
  onDeleteSession: (session: ConversationSummary) => Promise<void> | void;
  onToggleCollapsed: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    session: ConversationSummary;
    x: number;
    y: number;
  } | null>(null);
  const [renamingSession, setRenamingSession] = useState<ConversationSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (!sessionMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setSessionMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSessionMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [sessionMenu]);

  async function submitRename() {
    if (!renamingSession || isRenaming) {
      return;
    }

    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      return;
    }

    setIsRenaming(true);
    try {
      await onRenameSession(renamingSession, nextTitle);
      setRenamingSession(null);
      setRenameDraft("");
    } finally {
      setIsRenaming(false);
    }
  }

  async function deleteSession(session: ConversationSummary) {
    setSessionMenu(null);
    if (!window.confirm(`删除对话「${session.title}」？`)) {
      return;
    }

    await onDeleteSession(session);
  }

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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSessionMenu({
                      session,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
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

      {sessionMenu ? (
        <div
          ref={menuRef}
          className="browser-acp-session-context-menu"
          role="menu"
          aria-label="对话操作"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenamingSession(sessionMenu.session);
              setRenameDraft(sessionMenu.session.title);
              setSessionMenu(null);
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="browser-acp-session-context-menu-danger"
            onClick={() => void deleteSession(sessionMenu.session)}
          >
            删除
          </button>
        </div>
      ) : null}

      {renamingSession ? (
        <div className="browser-acp-session-rename-backdrop" role="presentation">
          <form
            className="browser-acp-session-rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="重命名对话"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <label htmlFor="browser-acp-session-rename-input">对话名称</label>
            <input
              id="browser-acp-session-rename-input"
              value={renameDraft}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenamingSession(null);
                  setRenameDraft("");
                }
              }}
            />
            <div className="browser-acp-session-rename-actions">
              <button
                type="button"
                className="browser-acp-secondary-button"
                onClick={() => {
                  setRenamingSession(null);
                  setRenameDraft("");
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="browser-acp-primary-button"
                disabled={isRenaming || renameDraft.trim().length === 0}
              >
                保存名称
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

function getAvatarLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "A";
}
