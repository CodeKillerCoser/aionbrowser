import type { ThreadMessage } from "@assistant-ui/react";
import type { BrowserContextBundle, SessionEvent } from "@browser-acp/shared-types";

interface TurnAggregate {
  turnId: string;
  prompt: string;
  startedAt: string;
  assistantChunks: string[];
  thoughtChunks: string[];
  stopReason?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  context?: BrowserContextBundle;
}

export function buildThreadMessages(events: SessionEvent[]): ThreadMessage[] {
  const turnOrder: string[] = [];
  const turns = new Map<string, TurnAggregate>();

  for (const event of events) {
    switch (event.type) {
      case "turn.started": {
        if (!turns.has(event.turnId)) {
          turnOrder.push(event.turnId);
        }

        turns.set(event.turnId, {
          turnId: event.turnId,
          prompt: event.prompt,
          startedAt: event.startedAt,
          assistantChunks: turns.get(event.turnId)?.assistantChunks ?? [],
          thoughtChunks: turns.get(event.turnId)?.thoughtChunks ?? [],
          stopReason: turns.get(event.turnId)?.stopReason,
          completedAt: turns.get(event.turnId)?.completedAt,
          failedAt: turns.get(event.turnId)?.failedAt,
          error: turns.get(event.turnId)?.error,
          context: turns.get(event.turnId)?.context,
        });
        break;
      }

      case "turn.delta": {
        if (!event.turnId) {
          break;
        }

        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        if (event.role === "agent" && event.chunk.length > 0) {
          current.assistantChunks.push(event.chunk);
        }
        if (event.updateKind === "agent_thought_chunk" && event.chunk.length > 0) {
          current.thoughtChunks.push(event.chunk);
        }
        break;
      }

      case "turn.completed": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.stopReason = normalizeStopReason(event.stopReason);
        current.completedAt = event.completedAt;
        break;
      }

      case "turn.failed": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.failedAt = event.failedAt;
        current.error = event.error;
        break;
      }

      case "context.attached": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.context = event.context;
        break;
      }

      case "session.started":
      case "agent.stateChanged":
        break;
    }
  }

  return turnOrder.flatMap((turnId) => {
    const turn = turns.get(turnId);
    if (!turn) {
      return [];
    }

    const assistantText = turn.assistantChunks.join("");
    const assistantContent =
      assistantText.length > 0
        ? [{ type: "text" as const, text: assistantText }]
        : turn.error
          ? [{ type: "text" as const, text: turn.error }]
          : [];
    const shouldRenderAssistant =
      assistantContent.length > 0 || Boolean(turn.error) || (!turn.completedAt && !turn.failedAt);

    const assistantMessage: ThreadMessage = {
      id: `assistant-${turnId}`,
      role: "assistant",
      createdAt: new Date(turn.completedAt ?? turn.failedAt ?? turn.startedAt),
      content: assistantContent,
      status: turn.failedAt
        ? {
            type: "incomplete",
            reason: "error",
            error: turn.error,
          }
        : turn.completedAt
          ? {
              type: "complete",
              reason: (turn.stopReason ?? "unknown") as "stop" | "unknown",
            }
          : {
              type: "running",
            },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {
          turnId,
          context: turn.context,
          thought: turn.thoughtChunks.join(""),
        },
      },
    };

    const messages: ThreadMessage[] = [];

    if (turn.prompt.trim().length > 0) {
      messages.push({
        id: `user-${turnId}`,
        role: "user",
        createdAt: new Date(turn.startedAt),
        content: [{ type: "text", text: turn.prompt }],
        attachments: [],
        metadata: {
          custom: {
            turnId,
          },
        },
      });
    }

    if (shouldRenderAssistant) {
      messages.push(assistantMessage);
    }

    return messages;
  });
}

function getOrCreateTurn(
  turns: Map<string, TurnAggregate>,
  turnOrder: string[],
  turnId: string,
): TurnAggregate {
  const existing = turns.get(turnId);
  if (existing) {
    return existing;
  }

  const created: TurnAggregate = {
    turnId,
    prompt: "",
    startedAt: new Date(0).toISOString(),
    assistantChunks: [],
    thoughtChunks: [],
  };
  turns.set(turnId, created);
  turnOrder.push(turnId);
  return created;
}

function normalizeStopReason(stopReason: string): "stop" | "unknown" {
  return stopReason === "stop" || stopReason === "end_turn" ? "stop" : "unknown";
}
