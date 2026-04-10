import { SELECTION_ACTION_PROMPTS } from "@browser-acp/config";
import type { PendingSelectionAction, SelectionActionType } from "../messages";

export interface PendingSelectionActionTarget {
  tabId?: number;
  windowId?: number;
}

export function createPendingSelectionActionService(deps: {
  getCurrentAction(): PendingSelectionAction | null;
  setCurrentAction(action: PendingSelectionAction | null): void;
  openSidePanel(windowId?: number): Promise<void>;
  persist(action: PendingSelectionAction): Promise<void>;
  load(): Promise<PendingSelectionAction | null>;
  clear(): Promise<void>;
  notifyReady(): Promise<void>;
  logQueuedAction(
    action: SelectionActionType,
    selectionText: string,
    target: PendingSelectionActionTarget,
  ): Promise<void>;
  randomId?: () => string;
  now?: () => string;
}) {
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async queue(
      action: SelectionActionType,
      selectionText: string,
      target: PendingSelectionActionTarget,
    ): Promise<{ ok: true }> {
      const nextAction: PendingSelectionAction = {
        id: randomId(),
        action,
        selectionText,
        promptText: SELECTION_ACTION_PROMPTS[action](selectionText),
        createdAt: now(),
      };

      deps.setCurrentAction(nextAction);
      await deps.openSidePanel(target.windowId);
      await deps.persist(nextAction);
      await deps.notifyReady();
      await deps.logQueuedAction(action, selectionText, target);

      return { ok: true };
    },

    async claim(): Promise<PendingSelectionAction | null> {
      const nextAction = deps.getCurrentAction() ?? await deps.load();
      deps.setCurrentAction(null);
      await deps.clear();
      return nextAction;
    },
  };
}
