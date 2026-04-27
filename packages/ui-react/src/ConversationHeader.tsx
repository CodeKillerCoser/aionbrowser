export function ConversationHeader({
  title,
  subtitle,
  debugEnabled,
  error,
  onDebugChange,
}: {
  title: string;
  subtitle: string;
  debugEnabled: boolean;
  error: string | null;
  onDebugChange: (enabled: boolean) => void;
}) {
  return (
    <header className="browser-acp-header">
      <div className="browser-acp-header-copy browser-acp-header-copy-conversation">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="browser-acp-header-meta">
        <label className="browser-acp-debug-toggle browser-acp-debug-toggle-inline">
          <span className="browser-acp-debug-toggle-label">Debug</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Debug"
            checked={debugEnabled}
            onChange={(event) => onDebugChange(event.target.checked)}
          />
          <span className="browser-acp-debug-toggle-state">{debugEnabled ? "On" : "Off"}</span>
        </label>
        {error ? <div className="browser-acp-error">{error}</div> : null}
      </div>
    </header>
  );
}
