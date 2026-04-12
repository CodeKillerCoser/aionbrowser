import type { BrowserContextBundle, PromptEnvelope } from "@browser-acp/shared-types";

export function buildPromptText(prompt: PromptEnvelope): string {
  return [
    "You are a local CLI agent running on the user's machine through Browser ACP.",
    "You can use any tools exposed by the runtime, including local filesystem tools when they are available.",
    "Do not claim that you are limited to the current web page or that you cannot access local files unless a tool call actually fails.",
    "If the user asks about local files, inspect them directly with the available tools instead of asking the user to open a terminal.",
    "If a filesystem or command action requires approval, request it through the runtime permission flow and continue after the user decides.",
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
