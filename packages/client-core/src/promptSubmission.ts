import type { BrowserContextBundle, PromptEnvelope } from "@browser-acp/shared-types";
import { PENDING_SESSION_ID } from "./optimisticPrompts.js";

export function canSubmitPrompt({
  hostReady,
  context,
  agentId,
  text,
}: {
  hostReady: boolean;
  context: BrowserContextBundle | null;
  agentId: string;
  text: string;
}): boolean {
  return hostReady && Boolean(context) && Boolean(agentId) && text.trim().length > 0;
}

export function buildPromptEnvelope({
  sessionId,
  agentId,
  text,
  context,
}: {
  sessionId: string;
  agentId: string;
  text: string;
  context: BrowserContextBundle;
}): PromptEnvelope {
  return {
    sessionId: sessionId || PENDING_SESSION_ID,
    agentId,
    text: text.trim(),
    context,
  };
}
