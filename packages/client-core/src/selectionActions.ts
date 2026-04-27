import type { BrowserContextBundle } from "@browser-acp/shared-types";

export function shouldHandleSelectionActionSignal(
  selectionActionSignal: number,
  lastHandledSignal: number,
): boolean {
  return selectionActionSignal !== 0 && lastHandledSignal !== selectionActionSignal;
}

export function canProcessSelectionAction({
  hostReady,
  context,
  agentId,
  inFlight,
}: {
  hostReady: boolean;
  context: BrowserContextBundle | null;
  agentId: string;
  inFlight: boolean;
}): boolean {
  return hostReady && Boolean(context) && Boolean(agentId) && !inFlight;
}
