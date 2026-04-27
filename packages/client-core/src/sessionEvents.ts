import type { SessionEvent } from "@browser-acp/shared-types";
import type { OptimisticPrompt } from "./optimisticPrompts.js";

export type EventsBySession = Record<string, SessionEvent[]>;

export function getSessionEvents(eventsBySession: EventsBySession, sessionId: string): SessionEvent[] {
  return eventsBySession[sessionId] ?? [];
}

export function appendSessionEvent(
  eventsBySession: EventsBySession,
  sessionId: string,
  event: SessionEvent,
): EventsBySession {
  return {
    ...eventsBySession,
    [sessionId]: [...getSessionEvents(eventsBySession, sessionId), event],
  };
}

export function filterOptimisticPromptsByStartedTurns(
  prompts: OptimisticPrompt[],
  sessionId: string,
  events: SessionEvent[],
): OptimisticPrompt[] {
  if (!sessionId) {
    return prompts;
  }

  const startedPrompts = new Set(
    events
      .filter((event): event is Extract<SessionEvent, { type: "turn.started" }> => event.type === "turn.started")
      .map((event) => event.prompt.trim())
      .filter(Boolean),
  );

  if (startedPrompts.size === 0) {
    return prompts;
  }

  return prompts.filter((prompt) => prompt.sessionId !== sessionId || !startedPrompts.has(prompt.text.trim()));
}

export function filterSubmittingPermissionIdsByResolvedEvents(
  permissionIds: string[],
  events: SessionEvent[],
): string[] {
  const resolvedPermissionIds = new Set(
    events
      .filter((event): event is Extract<SessionEvent, { type: "permission.resolved" }> => event.type === "permission.resolved")
      .map((event) => event.permissionId),
  );

  if (resolvedPermissionIds.size === 0) {
    return permissionIds;
  }

  return permissionIds.filter((permissionId) => !resolvedPermissionIds.has(permissionId));
}

export function markPermissionSubmitting(permissionIds: string[], permissionId: string): string[] {
  return permissionIds.includes(permissionId) ? permissionIds : [...permissionIds, permissionId];
}
