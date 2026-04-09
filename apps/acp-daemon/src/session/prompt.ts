import type { BrowserContextBundle, PromptEnvelope } from "@browser-acp/shared-types";

export function buildPromptText(prompt: PromptEnvelope): string {
  return [
    "You are helping the user read and understand the current web page.",
    "",
    formatContext(prompt.context),
    "",
    "User request:",
    prompt.text,
  ].join("\n");
}

function formatContext(context: BrowserContextBundle): string {
  const openTabs = context.openTabsPreview
    .map((tab) => `- ${tab.active ? "[active] " : ""}${tab.title} <${tab.url}>`)
    .join("\n");

  return [
    "Browser context:",
    `- Title: ${context.title}`,
    `- URL: ${context.url}`,
    `- Selected text: ${context.selectionText || "(none)"}`,
    "- Summary:",
    context.summaryMarkdown || "(no summary available)",
    "- Open tabs:",
    openTabs || "(only the current tab is available)",
  ].join("\n");
}
