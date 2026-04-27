export function LoadingIndicator({ label = "Assistant loading" }: { label?: string }) {
  return (
    <span className="browser-acp-loading-indicator" aria-label={label} role="status">
      <span className="browser-acp-loading-dot" aria-hidden="true" />
    </span>
  );
}
