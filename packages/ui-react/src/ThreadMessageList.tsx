import type { PermissionDecision } from "@browser-acp/shared-types";
import type { TranscriptItem, TranscriptPermissionItem } from "@browser-acp/client-core";
import { LoadingIndicator } from "./LoadingIndicator";
import { MarkdownMessage } from "./MarkdownMessage";
import { SystemEventRow } from "./SystemEventRow";

export function ThreadMessageList({
  messages,
  emptyMessage,
  isPermissionSubmitting = () => false,
  onResolvePermission,
}: {
  messages: TranscriptItem[];
  emptyMessage: string;
  isPermissionSubmitting?: (item: TranscriptPermissionItem) => boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  if (messages.length === 0) {
    return <p className="browser-acp-empty browser-acp-empty-main">{emptyMessage}</p>;
  }

  return (
    <>
      {messages.map((message) =>
        message.kind === "message" ? (
          <div
            key={message.id}
            className={`browser-acp-message browser-acp-thread-message browser-acp-thread-message-${message.role}`}
            data-message-id={message.id}
          >
            <div className="browser-acp-thread-message-body">
              {message.content.map((part, index) =>
                part.type === "text" ? (
                  <MarkdownMessage
                    key={`${message.id}-part-${index}`}
                    tone={message.role === "user" ? "user" : "assistant"}
                  >
                    {part.text}
                  </MarkdownMessage>
                ) : (
                  <pre key={`${message.id}-part-${index}`} className="browser-acp-thread-message-part-raw">
                    {JSON.stringify(part.value, null, 2)}
                  </pre>
                ),
              )}
              {message.status.type === "running" ? <LoadingIndicator /> : null}
            </div>
          </div>
        ) : (
          <SystemEventRow
            key={message.id}
            item={message}
            isSubmitting={message.systemType === "permission" ? isPermissionSubmitting(message) : false}
            onResolvePermission={onResolvePermission}
          />
        ),
      )}
      <div className="browser-acp-transcript-end-spacer" aria-hidden="true" />
    </>
  );
}
