import type {
  BrowserContextBundle,
  ConversationSummary,
  ModelState,
  PromptEnvelope,
  ResolvedAgent,
  SessionEvent,
} from "@browser-acp/shared-types";
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
    rename(sessionId: string, title: string): Promise<ConversationSummary> {
      return deps.manager.renameSession(sessionId, title);
    },
    delete(sessionId: string): Promise<void> {
      return deps.manager.deleteSession(sessionId);
    },
    readTranscript(sessionId: string): Promise<SessionEvent[]> {
      return deps.manager.readTranscript(sessionId);
    },
    getModels(sessionId: string): Promise<ModelState | null> {
      return deps.manager.getModels(sessionId);
    },
    getAgentModels(agent: ResolvedAgent): Promise<ModelState | null> {
      return deps.manager.getAgentModels(agent);
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
    setModel(sessionId: string, modelId: string): Promise<ModelState | null> {
      return deps.manager.setModel(sessionId, modelId);
    },
  };
}
