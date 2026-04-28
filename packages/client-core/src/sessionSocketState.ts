export type SessionSocketStatus = "idle" | "connecting" | "open" | "closed" | "error";
export type SessionSocketCallbackStatus = "open" | "close" | "error" | string;

export function isSessionSocketUnavailable(hasSocket: boolean, status: SessionSocketStatus): boolean {
  return !hasSocket || status !== "open";
}

export function getNextSessionSocketStatus(
  current: SessionSocketStatus,
  status: SessionSocketCallbackStatus,
): SessionSocketStatus {
  if (status === "open") {
    return "open";
  }
  if (status === "close") {
    return "closed";
  }
  if (status === "error") {
    return "error";
  }
  return current;
}

export function shouldClearSessionSocketRef(status: SessionSocketCallbackStatus): boolean {
  return status === "close" || status === "error";
}

export function shouldFlushPendingPrompt(
  status: SessionSocketCallbackStatus,
  pendingPromptSessionId: string | null | undefined,
  selectedSessionId: string,
): boolean {
  return status === "open" && pendingPromptSessionId === selectedSessionId;
}

export function shouldFlushPendingPermissions(
  status: SessionSocketCallbackStatus,
  pendingPermissionCount: number,
): boolean {
  return status === "open" && pendingPermissionCount > 0;
}
