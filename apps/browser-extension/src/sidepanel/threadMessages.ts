import type {
  BrowserContextBundle,
  PermissionOptionSummary,
  SessionEvent,
  ToolCallSnapshot,
} from "@browser-acp/shared-types";

export interface TranscriptMessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  createdAt: Date;
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "raw";
        value: unknown;
      }
  >;
  status:
    | {
        type: "running";
      }
    | {
        type: "complete";
        reason: "stop" | "unknown";
      }
    | {
        type: "incomplete";
        reason: "error";
        error?: string;
      };
  metadata?: {
    turnId: string;
    context?: BrowserContextBundle;
    thought?: string;
  };
}

export interface TranscriptThoughtItem {
  kind: "system";
  systemType: "thought";
  id: string;
  turnId: string | null;
  createdAt: Date;
  text: string;
  status: "running" | "complete" | "failed";
}

export interface TranscriptToolItem {
  kind: "system";
  systemType: "tool";
  id: string;
  turnId: string | null;
  createdAt: Date;
  toolCall: ToolCallSnapshot;
}

export interface TranscriptPermissionItem {
  kind: "system";
  systemType: "permission";
  id: string;
  turnId: string | null;
  createdAt: Date;
  permissionId: string;
  toolCall: ToolCallSnapshot;
  options: PermissionOptionSummary[];
  outcome?: "selected" | "cancelled";
  selectedOption?: PermissionOptionSummary | null;
}

export type TranscriptItem =
  | TranscriptMessageItem
  | TranscriptThoughtItem
  | TranscriptToolItem
  | TranscriptPermissionItem;

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
  systemItems: TranscriptItem[];
  thoughtItem?: TranscriptThoughtItem;
  toolItems: Map<string, TranscriptToolItem>;
  permissionItems: Map<string, TranscriptPermissionItem>;
}

interface SystemBucket {
  systemItems: TranscriptItem[];
  thoughtItem?: TranscriptThoughtItem;
  toolItems: Map<string, TranscriptToolItem>;
  permissionItems: Map<string, TranscriptPermissionItem>;
}

export function buildThreadMessages(events: SessionEvent[]): TranscriptItem[] {
  const turnOrder: string[] = [];
  const turns = new Map<string, TurnAggregate>();
  const orphanBucket: SystemBucket = {
    systemItems: [],
    toolItems: new Map(),
    permissionItems: new Map(),
  };

  for (const event of events) {
    switch (event.type) {
      case "turn.started": {
        if (!turns.has(event.turnId)) {
          turnOrder.push(event.turnId);
        }

        const current = turns.get(event.turnId);
        turns.set(event.turnId, {
          turnId: event.turnId,
          prompt: event.prompt,
          startedAt: event.startedAt,
          assistantChunks: current?.assistantChunks ?? [],
          thoughtChunks: current?.thoughtChunks ?? [],
          stopReason: current?.stopReason,
          completedAt: current?.completedAt,
          failedAt: current?.failedAt,
          error: current?.error,
          context: current?.context,
          systemItems: current?.systemItems ?? [],
          thoughtItem: current?.thoughtItem,
          toolItems: current?.toolItems ?? new Map(),
          permissionItems: current?.permissionItems ?? new Map(),
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

          if (!current.thoughtItem) {
            current.thoughtItem = {
              kind: "system",
              systemType: "thought",
              id: `thought-${event.turnId}`,
              turnId: event.turnId,
              createdAt: new Date(current.startedAt),
              text: event.chunk,
              status: "running",
            };
            current.systemItems.push(current.thoughtItem);
          } else {
            current.thoughtItem.text += event.chunk;
          }
        }
        break;
      }

      case "turn.completed": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.stopReason = normalizeStopReason(event.stopReason);
        current.completedAt = event.completedAt;
        if (current.thoughtItem) {
          current.thoughtItem.status = "complete";
        }
        break;
      }

      case "turn.failed": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.failedAt = event.failedAt;
        current.error = event.error;
        if (current.thoughtItem) {
          current.thoughtItem.status = "failed";
        }
        break;
      }

      case "context.attached": {
        const current = getOrCreateTurn(turns, turnOrder, event.turnId);
        current.context = event.context;
        break;
      }

      case "tool.call": {
        const bucket = getSystemBucket(turns, turnOrder, orphanBucket, event.turnId);
        const existing = bucket.toolItems.get(event.toolCall.toolCallId);
        if (existing) {
          existing.toolCall = mergeToolCallSnapshots(existing.toolCall, event.toolCall);
        } else {
          const item: TranscriptToolItem = {
            kind: "system",
            systemType: "tool",
            id: `tool-${event.toolCall.toolCallId}`,
            turnId: event.turnId,
            createdAt: new Date(event.createdAt),
            toolCall: event.toolCall,
          };
          bucket.toolItems.set(event.toolCall.toolCallId, item);
          bucket.systemItems.push(item);
        }
        break;
      }

      case "tool.call.update": {
        const bucket = getSystemBucket(turns, turnOrder, orphanBucket, event.turnId);
        const existing = bucket.toolItems.get(event.toolCall.toolCallId);
        if (existing) {
          existing.toolCall = mergeToolCallSnapshots(existing.toolCall, event.toolCall);
        } else {
          const item: TranscriptToolItem = {
            kind: "system",
            systemType: "tool",
            id: `tool-${event.toolCall.toolCallId}`,
            turnId: event.turnId,
            createdAt: new Date(event.createdAt),
            toolCall: event.toolCall,
          };
          bucket.toolItems.set(event.toolCall.toolCallId, item);
          bucket.systemItems.push(item);
        }
        break;
      }

      case "permission.requested": {
        const bucket = getSystemBucket(turns, turnOrder, orphanBucket, event.turnId);
        const item: TranscriptPermissionItem = {
          kind: "system",
          systemType: "permission",
          id: `permission-${event.permissionId}`,
          turnId: event.turnId,
          createdAt: new Date(event.createdAt),
          permissionId: event.permissionId,
          toolCall: event.toolCall,
          options: event.options,
        };
        bucket.permissionItems.set(event.permissionId, item);
        bucket.systemItems.push(item);
        break;
      }

      case "permission.resolved": {
        const bucket = getSystemBucket(turns, turnOrder, orphanBucket, event.turnId);
        const existing = bucket.permissionItems.get(event.permissionId);
        if (existing) {
          existing.outcome = event.outcome;
          existing.selectedOption = event.selectedOption ?? null;
        } else {
          const item: TranscriptPermissionItem = {
            kind: "system",
            systemType: "permission",
            id: `permission-${event.permissionId}`,
            turnId: event.turnId,
            createdAt: new Date(event.createdAt),
            permissionId: event.permissionId,
            toolCall: {
              toolCallId: event.toolCallId,
            },
            options: [],
            outcome: event.outcome,
            selectedOption: event.selectedOption ?? null,
          };
          bucket.permissionItems.set(event.permissionId, item);
          bucket.systemItems.push(item);
        }
        break;
      }

      case "session.started":
      case "agent.stateChanged":
        break;
    }
  }

  return [
    ...orphanBucket.systemItems,
    ...turnOrder.flatMap((turnId) => {
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

      const items: TranscriptItem[] = [];

      if (turn.prompt.trim().length > 0) {
        items.push({
          kind: "message",
          id: `user-${turnId}`,
          role: "user",
          createdAt: new Date(turn.startedAt),
          content: [{ type: "text", text: turn.prompt }],
          status: { type: "complete", reason: "stop" },
          metadata: {
            turnId,
          },
        });
      }

      items.push(...turn.systemItems);

      if (shouldRenderAssistant) {
        items.push({
          kind: "message",
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
                  reason: turn.stopReason ?? "unknown",
                }
              : {
                  type: "running",
                },
          metadata: {
            turnId,
            context: turn.context,
            thought: turn.thoughtChunks.join(""),
          },
        });
      }

      return items;
    }),
  ];
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
    systemItems: [],
    toolItems: new Map(),
    permissionItems: new Map(),
  };
  turns.set(turnId, created);
  turnOrder.push(turnId);
  return created;
}

function getSystemBucket(
  turns: Map<string, TurnAggregate>,
  turnOrder: string[],
  orphanBucket: SystemBucket,
  turnId: string | null,
): SystemBucket {
  if (!turnId) {
    return orphanBucket;
  }

  return getOrCreateTurn(turns, turnOrder, turnId);
}

function mergeToolCallSnapshots(
  current: ToolCallSnapshot,
  next: ToolCallSnapshot,
): ToolCallSnapshot {
  return {
    toolCallId: current.toolCallId,
    title: next.title ?? current.title ?? null,
    kind: next.kind ?? current.kind ?? null,
    status: next.status ?? current.status ?? null,
    locations: next.locations ?? current.locations ?? null,
    rawInput: next.rawInput ?? current.rawInput,
    rawOutput: next.rawOutput ?? current.rawOutput,
    content: next.content ?? current.content ?? null,
  };
}

function normalizeStopReason(stopReason: string): "stop" | "unknown" {
  return stopReason === "stop" || stopReason === "end_turn" ? "stop" : "unknown";
}
