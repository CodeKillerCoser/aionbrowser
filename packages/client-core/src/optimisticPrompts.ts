import type { BrowserContextBundle } from "@browser-acp/shared-types";
import type { TranscriptItem, TranscriptMessageItem } from "./threadMessages.js";

export const PENDING_SESSION_ID = "pending-session";

export interface OptimisticPrompt {
  id: string;
  sessionId: string;
  agentId: string;
  text: string;
  createdAt: Date;
  context?: BrowserContextBundle;
  failureMessage?: string;
}

export function createOptimisticPromptId(): string {
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function addOptimisticPrompt(
  current: OptimisticPrompt[],
  prompt: Omit<OptimisticPrompt, "sessionId" | "text"> & {
    sessionId?: string;
    text: string;
  },
): OptimisticPrompt[] {
  return [
    ...current,
    {
      ...prompt,
      sessionId: prompt.sessionId || PENDING_SESSION_ID,
      text: prompt.text.trim(),
    },
  ];
}

export function updateOptimisticPromptContext(
  prompts: OptimisticPrompt[],
  promptId: string,
  context: BrowserContextBundle,
): OptimisticPrompt[] {
  return updateOptimisticPrompt(prompts, promptId, (prompt) => ({ ...prompt, context }));
}

export function moveOptimisticPromptToSession(
  prompts: OptimisticPrompt[],
  promptId: string,
  sessionId: string,
): OptimisticPrompt[] {
  return updateOptimisticPrompt(prompts, promptId, (prompt) => ({ ...prompt, sessionId }));
}

export function markOptimisticPromptFailed(
  prompts: OptimisticPrompt[],
  promptId: string,
  failureMessage: string,
): OptimisticPrompt[] {
  return updateOptimisticPrompt(prompts, promptId, (prompt) => ({ ...prompt, failureMessage }));
}

export function mergeOptimisticPrompts(
  baseMessages: TranscriptItem[],
  optimisticPrompts: OptimisticPrompt[],
  activeSessionId: string,
): TranscriptItem[] {
  const existingUserTexts = new Set(
    baseMessages
      .filter((item): item is TranscriptMessageItem => item.kind === "message" && item.role === "user")
      .map((item) => item.content.map((part) => (part.type === "text" ? part.text : "")).join("").trim())
      .filter(Boolean),
  );
  const visibleOptimisticMessages = optimisticPrompts
    .filter((prompt) => prompt.sessionId === activeSessionId)
    .filter((prompt) => !existingUserTexts.has(prompt.text.trim()))
    .flatMap(optimisticPromptToMessages);

  if (visibleOptimisticMessages.length === 0) {
    return baseMessages;
  }

  return [...baseMessages, ...visibleOptimisticMessages];
}

function updateOptimisticPrompt(
  prompts: OptimisticPrompt[],
  promptId: string,
  update: (prompt: OptimisticPrompt) => OptimisticPrompt,
): OptimisticPrompt[] {
  return prompts.map((prompt) => (prompt.id === promptId ? update(prompt) : prompt));
}

function optimisticPromptToMessages(prompt: OptimisticPrompt): TranscriptMessageItem[] {
  const userMessage: TranscriptMessageItem = {
    kind: "message",
    id: prompt.id,
    role: "user",
    createdAt: prompt.createdAt,
    content: [{ type: "text", text: prompt.text }],
    status: { type: "complete", reason: "stop" },
    metadata: {
      turnId: prompt.id,
      context: prompt.context,
    },
  };

  if (!prompt.failureMessage) {
    return [
      userMessage,
      {
        kind: "message",
        id: `${prompt.id}-loading`,
        role: "assistant",
        createdAt: prompt.createdAt,
        content: [],
        status: {
          type: "running",
        },
        metadata: {
          turnId: prompt.id,
          context: prompt.context,
        },
      },
    ];
  }

  return [
    userMessage,
    {
      kind: "message",
      id: `${prompt.id}-failure`,
      role: "assistant",
      createdAt: new Date(),
      content: [{ type: "text", text: `发送失败：${prompt.failureMessage}` }],
      status: {
        type: "incomplete",
        reason: "error",
        error: prompt.failureMessage,
      },
      metadata: {
        turnId: prompt.id,
        context: prompt.context,
      },
    },
  ];
}
