export function ConversationDebugPanel({
  contextHeading,
  contextTitle,
  contextUrl,
  selectedText,
  diagnosticsText,
  onRefreshDiagnostics,
}: {
  contextHeading: string;
  contextTitle: string | null | undefined;
  contextUrl: string | null | undefined;
  selectedText: string | null | undefined;
  diagnosticsText: string;
  onRefreshDiagnostics: () => void;
}) {
  return (
    <section className="browser-acp-debug-panel-shell">
      <div className="browser-acp-debug-panel">
        <section className="browser-acp-debug-group">
          <h3>{contextHeading}</h3>
          <dl className="browser-acp-debug-meta">
            <div className="browser-acp-debug-meta-row">
              <dt>Title</dt>
              <dd className="browser-acp-debug-value">{contextTitle ?? "none"}</dd>
            </div>
            <div className="browser-acp-debug-meta-row">
              <dt>Link</dt>
              <dd className="browser-acp-debug-value">
                {contextUrl ? (
                  <a
                    className="browser-acp-debug-link"
                    href={contextUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {contextUrl}
                  </a>
                ) : (
                  "none"
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="browser-acp-debug-group">
          <h3>Selected Text</h3>
          <pre className="browser-acp-debug-selection">{selectedText || "none"}</pre>
        </section>

        <section className="browser-acp-debug-group">
          <div className="browser-acp-debug-group-header">
            <h3>Runtime Logs</h3>
            <button
              type="button"
              className="browser-acp-secondary-button"
              onClick={onRefreshDiagnostics}
            >
              Refresh
            </button>
          </div>
          <textarea
            className="browser-acp-diagnostics"
            readOnly
            value={diagnosticsText}
            aria-label="Runtime logs"
          />
        </section>
      </div>
    </section>
  );
}
