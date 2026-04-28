import type { BrowserContextBundle, PageTaskTemplate } from "@browser-acp/shared-types";

export const DEFAULT_PAGE_TASK_TEMPLATES: PageTaskTemplate[] = [
  {
    id: "explain",
    title: "解释",
    promptTemplate: "请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\n{{selectionText}}",
    enabled: true,
  },
  {
    id: "search",
    title: "搜索",
    promptTemplate: "请基于下面这段内容，提炼搜索关键词、核心问题，并给出后续搜索方向：\n\n{{selectionText}}",
    enabled: true,
  },
  {
    id: "examples",
    title: "提供样例",
    promptTemplate: "请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\n{{selectionText}}",
    enabled: true,
  },
];

export function createPageTaskTemplate(): PageTaskTemplate {
  return {
    id: `template-${Date.now().toString(36)}`,
    title: "新操作",
    promptTemplate: "请基于当前页面上下文处理下面内容：\n\n{{selectionText}}",
    enabled: true,
  };
}

export function sanitizePageTaskTemplates(value: unknown): PageTaskTemplate[] {
  const templates = Array.isArray(value)
    ? value
        .map((entry): PageTaskTemplate | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const record = entry as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id.trim() : "";
          const title = typeof record.title === "string" ? record.title.trim() : "";
          const promptTemplate = typeof record.promptTemplate === "string" ? record.promptTemplate.trim() : "";
          if (!id || !title || !promptTemplate) {
            return null;
          }

          return {
            id,
            title,
            promptTemplate,
            enabled: record.enabled !== false,
          };
        })
        .filter((entry): entry is PageTaskTemplate => Boolean(entry))
    : [];

  return templates.length > 0 ? templates : DEFAULT_PAGE_TASK_TEMPLATES;
}

export function renderPageTaskPrompt(template: PageTaskTemplate, context: BrowserContextBundle): string {
  const values: Record<string, string> = {
    selectionText: context.selectionText,
    pageTitle: context.title,
    pageUrl: context.url,
    pageSummary: context.summaryMarkdown,
    openTabs: context.openTabsPreview
      .map((tab) => `${tab.active ? "[active] " : ""}${tab.title} <${tab.url}>`)
      .join("\n"),
  };

  return template.promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match: string, key: string) => values[key] ?? "");
}
