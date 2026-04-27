import { useState } from "react";
import type { PermissionDecision, ToolCallContentSummary } from "@browser-acp/shared-types";
import type {
  TranscriptItem,
  TranscriptMessageItem,
  TranscriptPermissionItem,
  TranscriptThoughtItem,
  TranscriptToolItem,
} from "@browser-acp/client-core";
import { LoadingIndicator } from "./LoadingIndicator";
import { MarkdownMessage } from "./MarkdownMessage";

type NonThoughtSystemItem = TranscriptToolItem | TranscriptPermissionItem;

export function SystemEventRow({
  item,
  isSubmitting,
  onResolvePermission,
}: {
  item: Exclude<TranscriptItem, TranscriptMessageItem>;
  isSubmitting: boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  if (item.systemType === "thought") {
    return <ThoughtEventRow item={item} />;
  }

  if (item.systemType === "permission") {
    return (
      <PermissionEventRow
        item={item}
        isSubmitting={isSubmitting}
        onResolvePermission={onResolvePermission}
      />
    );
  }

  if (item.systemType === "tool") {
    return <ToolEventRow item={item} />;
  }

  return null;
}

function ThoughtEventRow({ item }: { item: TranscriptThoughtItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = getThoughtStatus(item.status);
  const showLoading = item.status === "running";

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <button
        type="button"
        className="browser-acp-system-row-summary-toggle browser-acp-thought-toggle"
        aria-expanded={expanded}
        aria-label={status.text}
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="browser-acp-system-row-header">
          <div className="browser-acp-system-row-copy browser-acp-thought-summary">
            {showLoading ? (
              <LoadingIndicator label="Thought loading" />
            ) : (
              <span
                className={`browser-acp-system-row-chevron browser-acp-thought-chevron${expanded ? " browser-acp-system-row-chevron-expanded" : ""}`}
                aria-hidden="true"
              >
                {expanded ? "▾" : "▸"}
              </span>
            )}
            <span className={`browser-acp-thought-state browser-acp-thought-state-${status.tone}`}>{status.text}</span>
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="browser-acp-system-row-body browser-acp-thought-body">
          <p>{item.text}</p>
        </div>
      ) : null}
    </div>
  );
}

function getThoughtStatus(status: TranscriptThoughtItem["status"]): {
  text: string;
  tone: "neutral" | "success" | "warning" | "danger";
} {
  if (status === "running") {
    return {
      text: "思考中",
      tone: "warning",
    };
  }

  if (status === "failed") {
    return {
      text: "已失败",
      tone: "danger",
    };
  }

  return {
    text: "已完成",
    tone: "success",
  };
}

function ToolEventRow({ item }: { item: TranscriptToolItem }) {
  const [expanded, setExpanded] = useState(false);
  const header = getSystemEventHeader(item);
  const status = getSystemEventStatus(item);
  const detail = getSystemEventDetail(item);
  const hasDetail = Boolean(detail?.body.trim());

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <SystemEventSummary
        header={header}
        status={status}
        expanded={hasDetail ? expanded : undefined}
        onToggle={hasDetail ? () => setExpanded((current) => !current) : undefined}
      />
      {expanded && detail ? (
        <div className="browser-acp-system-row-body">
          <MarkdownMessage>{detail.body}</MarkdownMessage>
        </div>
      ) : null}
    </div>
  );
}

function PermissionEventRow({
  item,
  isSubmitting,
  onResolvePermission,
}: {
  item: TranscriptPermissionItem;
  isSubmitting: boolean;
  onResolvePermission: (item: TranscriptPermissionItem, decision: PermissionDecision) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const header = getSystemEventHeader(item);
  const status = getSystemEventStatus(item);
  const detail = getSystemEventDetail(item);
  const hasDetail = Boolean(detail?.body.trim());
  const canRespond = !item.outcome;

  return (
    <div
      className={`browser-acp-system-row browser-acp-system-row-${item.systemType}`}
      data-system-event-type={item.systemType}
    >
      <SystemEventSummary
        header={header}
        status={status}
        expanded={hasDetail ? expanded : undefined}
        onToggle={hasDetail ? () => setExpanded((current) => !current) : undefined}
      />
      {expanded && detail ? (
        <div className="browser-acp-system-row-body">
          <MarkdownMessage>{detail.body}</MarkdownMessage>
        </div>
      ) : null}
      {canRespond ? (
        <div className="browser-acp-permission-actions">
          {item.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              className={`browser-acp-permission-action browser-acp-permission-action-${getPermissionOptionTone(option.kind)}`}
              disabled={isSubmitting}
              onClick={() =>
                onResolvePermission(item, {
                  permissionId: item.permissionId,
                  outcome: "selected",
                  optionId: option.optionId,
                })
              }
            >
              {formatPermissionOptionLabel(option.kind, option.name)}
            </button>
          ))}
          <button
            type="button"
            className="browser-acp-permission-action browser-acp-permission-action-neutral"
            disabled={isSubmitting}
            onClick={() =>
              onResolvePermission(item, {
                permissionId: item.permissionId,
                outcome: "cancelled",
              })
            }
          >
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SystemEventSummary({
  header,
  status,
  expanded,
  onToggle,
}: {
  header: { label: string; title: string | null; command: string | null };
  status: { text: string; tone: "neutral" | "success" | "warning" | "danger" } | null;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isInteractive = typeof expanded === "boolean" && typeof onToggle === "function";

  const content = (
    <div className="browser-acp-system-row-header">
      <div className="browser-acp-system-row-copy">
        <p className="browser-acp-system-row-summary">
          <span className="browser-acp-system-row-summary-label">{header.label}：</span>
          {header.title ? <strong className="browser-acp-system-row-summary-title">{header.title}</strong> : null}
          {header.command ? (
            <>
              {header.title ? (
                <span className="browser-acp-system-row-summary-separator" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <code className="browser-acp-system-row-summary-command">{header.command}</code>
            </>
          ) : null}
        </p>
      </div>
      <div className="browser-acp-system-row-meta">
        {status ? (
          <span className={`browser-acp-system-row-status browser-acp-system-row-status-${status.tone}`}>{status.text}</span>
        ) : null}
        {isInteractive ? (
          <span
            className={`browser-acp-system-row-chevron${expanded ? " browser-acp-system-row-chevron-expanded" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        ) : null}
      </div>
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className="browser-acp-system-row-summary-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {content}
      </button>
    );
  }

  return content;
}

function getSystemEventHeader(item: NonThoughtSystemItem): { label: string; title: string | null; command: string | null } {
  const command = summarizeToolCommand(item.toolCall);
  const inputSummary = summarizeToolInput(item.toolCall.rawInput);
  const title = dedupeSystemEventTitle(item.toolCall.title, command, inputSummary);

  switch (item.systemType) {
    case "tool":
      return {
        label: "工具调用",
        title: title ?? (!command ? item.toolCall.title ?? "执行工具操作" : null),
        command,
      };
    case "permission":
      return {
        label: "权限请求",
        title: title ?? (!command ? item.toolCall.title ?? "请求执行权限" : null),
        command,
      };
  }
}

function getSystemEventStatus(
  item: NonThoughtSystemItem,
): { text: string; tone: "neutral" | "success" | "warning" | "danger" } | null {
  if (item.systemType === "tool") {
    const status = item.toolCall.status ?? "pending";
    return {
      text: formatToolStatus(status),
      tone:
        status === "completed"
          ? "success"
          : status === "failed"
            ? "danger"
            : status === "in_progress"
              ? "warning"
              : "neutral",
    };
  }

  if (!item.outcome) {
    return {
      text: "待你确认",
      tone: "warning",
    };
  }

  if (item.outcome === "cancelled") {
    return {
      text: "已取消",
      tone: "neutral",
    };
  }

  if (item.selectedOption?.kind.startsWith("reject")) {
    return {
      text: "已拒绝",
      tone: "danger",
    };
  }

  return {
    text: "已允许",
    tone: "success",
  };
}

function getSystemEventDetail(item: NonThoughtSystemItem): { label: string; body: string } | null {
  if (item.systemType === "tool") {
    return buildToolCallDetail(item);
  }

  return buildPermissionDetail(item);
}

function buildToolCallDetail(item: TranscriptToolItem): { label: string; body: string } | null {
  const resultSections: string[] = [];
  const contentSections = item.toolCall.content
    ?.map((content) => formatToolContentMarkdown(content))
    .filter(Boolean) as string[] | undefined;
  if (contentSections?.length) {
    resultSections.push(contentSections.join("\n\n"));
  }

  if (item.toolCall.rawOutput !== undefined) {
    resultSections.push(["输出：", "```json", safeJsonStringify(item.toolCall.rawOutput), "```"].join("\n"));
  }

  if (resultSections.length > 0) {
    return {
      label: "工具结果",
      body: resultSections.join("\n\n"),
    };
  }

  if (item.toolCall.rawInput !== undefined) {
    return {
      label: "调用参数",
      body: ["输入：", "```json", safeJsonStringify(item.toolCall.rawInput), "```"].join("\n"),
    };
  }

  if (item.toolCall.locations?.length) {
    return {
      label: "涉及文件",
      body: item.toolCall.locations.map((location) => `- \`${formatLocation(location.path, location.line)}\``).join("\n"),
    };
  }

  return null;
}

function buildPermissionDetail(item: TranscriptPermissionItem): { label: string; body: string } | null {
  if (item.toolCall.rawInput === undefined) {
    return null;
  }

  return {
    label: "请求输入",
    body: ["请求输入：", "```json", safeJsonStringify(item.toolCall.rawInput), "```"].join("\n"),
  };
}

function getPermissionOptionTone(kind: TranscriptPermissionItem["options"][number]["kind"]): "success" | "danger" | "neutral" {
  if (kind.startsWith("allow")) {
    return "success";
  }

  if (kind.startsWith("reject")) {
    return "danger";
  }

  return "neutral";
}

function formatPermissionOptionLabel(
  kind: TranscriptPermissionItem["options"][number]["kind"],
  fallbackName: string,
): string {
  switch (kind) {
    case "allow_once":
      return "允许本次";
    case "allow_always":
      return "始终允许";
    case "reject_once":
      return "拒绝本次";
    case "reject_always":
      return "始终拒绝";
    default:
      return fallbackName;
  }
}

function summarizeToolCommand(toolCall: TranscriptToolItem["toolCall"]): string | null {
  const inputSummary = summarizeToolInput(toolCall.rawInput);

  if (toolCall.kind && inputSummary) {
    return `${toolCall.kind} ${inputSummary}`;
  }

  if (inputSummary) {
    return inputSummary;
  }

  if (toolCall.kind) {
    return toolCall.kind;
  }

  return null;
}

function dedupeSystemEventTitle(
  title: string | null | undefined,
  command: string | null,
  inputSummary: string | null,
): string | null {
  if (!title) {
    return null;
  }

  const normalizedTitle = normalizeInlineComparison(title);
  if (!normalizedTitle) {
    return null;
  }

  if (command && normalizedTitle === normalizeInlineComparison(command)) {
    return null;
  }

  if (inputSummary && normalizedTitle === normalizeInlineComparison(inputSummary)) {
    return null;
  }

  return title;
}

function summarizeToolInput(rawInput: unknown): string | null {
  if (typeof rawInput === "string") {
    return truncateInline(rawInput, 72);
  }

  if (typeof rawInput === "number" || typeof rawInput === "boolean") {
    return String(rawInput);
  }

  if (Array.isArray(rawInput)) {
    const summary = rawInput
      .map((value) => summarizeToolInput(value))
      .filter((value): value is string => Boolean(value))
      .join(" ");

    return summary ? truncateInline(summary, 72) : null;
  }

  if (!rawInput || typeof rawInput !== "object") {
    return null;
  }

  const preferredKeys = ["command", "path", "filePath", "url", "query", "target", "name"] as const;
  const record = rawInput as Record<string, unknown>;

  for (const key of preferredKeys) {
    const value = record[key];
    const summary = summarizeToolInput(value);
    if (summary) {
      return summary;
    }
  }

  const compactEntries = Object.entries(record)
    .slice(0, 2)
    .map(([key, value]) => `${key}=${summarizeToolInput(value) ?? truncateInline(safeJsonStringify(value), 28)}`)
    .join(" ");

  return compactEntries ? truncateInline(compactEntries, 72) : null;
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeInlineComparison(value: string): string {
  return value
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatToolContentMarkdown(content: ToolCallContentSummary): string {
  switch (content.type) {
    case "text":
      return content.text ? `结果：\n> ${content.text.replace(/\n/g, "\n> ")}` : "";
    case "diff":
      return [
        `变更文件：\`${content.path ?? "unknown"}\``,
        "```diff",
        buildDiffPreview(content.oldText ?? "", content.newText ?? ""),
        "```",
      ].join("\n");
    case "terminal":
      return `终端会话：\`${content.terminalId}\``;
    case "resource_link":
    case "resource":
      return [
        `资源：${content.title ?? content.name ?? content.uri ?? "unknown"}`,
        content.uri ? `[打开资源](${content.uri})` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "image":
      return `图片输出${content.mimeType ? `：\`${content.mimeType}\`` : ""}`;
    case "audio":
      return `音频输出${content.mimeType ? `：\`${content.mimeType}\`` : ""}`;
    default:
      return "";
  }
}

function buildDiffPreview(oldText: string, newText: string): string {
  if (!oldText && newText) {
    return newText
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n");
  }

  return ["--- before", oldText, "+++ after", newText].join("\n");
}

function formatToolStatus(status: TranscriptToolItem["toolCall"]["status"]): string {
  switch (status) {
    case "in_progress":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "pending":
    default:
      return "等待中";
  }
}

function formatLocation(path: string, line?: number | null): string {
  return line ? `${path}:${line}` : path;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
