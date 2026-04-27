import type { RefObject } from "react";
import type { PermissionDecision } from "@browser-acp/shared-types";
import type { TranscriptItem, TranscriptPermissionItem } from "@browser-acp/client-core";
import { ThreadMessageList } from "./ThreadMessageList";

export function TranscriptPane({
  viewportRef,
  messages,
  emptyMessage,
  isPermissionSubmitting,
  onResolvePermission,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  messages: TranscriptItem[];
  emptyMessage: string;
  isPermissionSubmitting: (item: TranscriptPermissionItem) => boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  return (
    <div className={`browser-acp-transcript${messages.length > 0 ? "" : " browser-acp-transcript-empty"}`}>
      <div
        ref={viewportRef}
        className="browser-acp-transcript-scroll"
        data-testid="session-event-log"
      >
        <ThreadMessageList
          messages={messages}
          emptyMessage={emptyMessage}
          isPermissionSubmitting={isPermissionSubmitting}
          onResolvePermission={onResolvePermission}
        />
      </div>
    </div>
  );
}
