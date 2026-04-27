import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContextBundle } from "@browser-acp/shared-types";

interface BrowserContextFileInput {
  cwd: string;
  sessionId: string;
  turnId: string;
  context: BrowserContextBundle;
}

export async function createBrowserContextFileReference(input: BrowserContextFileInput): Promise<string> {
  const dir = join(
    input.cwd,
    ".browser-acp",
    "tmp",
    "browser-contexts",
    sanitizePathSegment(input.sessionId),
  );
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, `${sanitizePathSegment(input.turnId)}.md`);
  await writeFile(filePath, formatBrowserContextMarkdown(input.context), "utf8");
  return filePath;
}

function formatBrowserContextMarkdown(context: BrowserContextBundle): string {
  const openTabs = context.openTabsPreview
    .map((tab) => `- ${tab.active ? "[active] " : ""}${tab.title} <${tab.url}>`)
    .join("\n");

  return [
    "# Browser Context",
    "",
    `- Captured at: ${context.capturedAt}`,
    `- Tab ID: ${context.tabId}`,
    `- Title: ${context.title}`,
    `- URL: ${context.url}`,
    "",
    "## Selected Text",
    "",
    context.selectionText || "(none)",
    "",
    "## Summary",
    "",
    context.summaryMarkdown || "(no summary available)",
    "",
    "## Open Tabs",
    "",
    openTabs || "(only the current tab is available)",
    "",
  ].join("\n");
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}
