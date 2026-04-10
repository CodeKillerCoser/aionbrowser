import type { BrowserContextBundle, ConversationSummary, PromptEnvelope, ResolvedAgent, SessionEvent } from "@browser-acp/shared-types";
import type { SessionManager } from "../session/sessionManager.js";

type SessionSubscriber = (event: SessionEvent) => void;

export function createSessionService(deps: { manager: SessionManager }) {
  return {
    list(): Promise<ConversationSummary[]> {
      return deps.manager.listSessions();
    },
    create(input: { agent: ResolvedAgent; context: BrowserContextBundle }): Promise<ConversationSummary> {
      return deps.manager.createSession(input);
    },
    readTranscript(sessionId: string): Promise<SessionEvent[]> {
      return deps.manager.readTranscript(sessionId);
    },
    sendPrompt(prompt: PromptEnvelope) {
      return deps.manager.sendPrompt(prompt);
    },
    subscribe(sessionId: string, subscriber: SessionSubscriber) {
      return deps.manager.subscribe(sessionId, subscriber);
    },
    cancel(sessionId: string) {
      return deps.manager.cancel(sessionId);
    },
  };
}
