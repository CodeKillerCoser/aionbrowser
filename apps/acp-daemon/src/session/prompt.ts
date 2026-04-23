import type { PromptEnvelope } from "@browser-acp/shared-types";

interface BuildPromptTextOptions {
  browserContextPath?: string;
  promptPrefix?: string;
}

export function buildPromptText(prompt: PromptEnvelope, options: BuildPromptTextOptions = {}): string {
  const sections = [
    options.promptPrefix?.trim(),
    formatContextReference(options.browserContextPath),
    ["User request:", prompt.text].join("\n"),
  ].filter((section) => Boolean(section));

  return sections.join("\n\n");
}

function formatContextReference(browserContextPath: string | undefined): string {
  if (!browserContextPath) {
    return [
      "Browser context:",
      "- No browser context file was attached for this turn.",
    ].join("\n");
  }

  return [
    "Browser context:",
    `- The browser context for this turn is available at: ${browserContextPath}`,
    "- Read that file if the user asks about the current page, selected text, URL, tabs, or browser state.",
  ].join("\n");
}
