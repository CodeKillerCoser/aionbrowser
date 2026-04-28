import type { BrowserContextTimelineEntry } from "@browser-acp/shared-types";

export function ConversationDebugPanel({
  contextHeading,
  contextTitle,
  contextUrl,
  selectedText,
  diagnosticsText,
  contextHistory = [],
  onRefreshDiagnostics,
}: {
  contextHeading: string;
  contextTitle: string | null | undefined;
  contextUrl: string | null | undefined;
  selectedText: string | null | undefined;
  diagnosticsText: string;
  contextHistory?: BrowserContextTimelineEntry[];
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
          <h3>Browser Context Timeline</h3>
          <div className="browser-acp-context-timeline">
            {contextHistory.length > 0 ? (
              contextHistory.slice(-12).reverse().map((entry) => (
                <article key={entry.id} className="browser-acp-context-timeline-entry">
                  <div className="browser-acp-context-timeline-meta">
                    <strong>{entry.reason}</strong>
                    <time dateTime={entry.capturedAt}>{formatContextTime(entry.capturedAt)}</time>
                  </div>
                  <p>{entry.context.title || "Untitled page"}</p>
                  <small>{entry.context.url || "no url"}</small>
                </article>
              ))
            ) : (
              <p className="browser-acp-empty">No context history yet.</p>
            )}
          </div>
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

function formatContextTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
