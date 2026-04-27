import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContextBundle, PromptEnvelope } from "@browser-acp/shared-types";
import { buildPromptText } from "@browser-acp/runtime-core";
import { createBrowserContextFileReference } from "@browser-acp/runtime-node";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("runtime browser context files", () => {
  it("writes dynamic browser context under the workspace and keeps prompt compact", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-context-"));
    tempDirs.push(rootDir);
    const context: BrowserContextBundle = {
      tabId: 42,
      url: "https://example.com/article",
      title: "Example article",
      selectionText: "Important selection",
      summaryMarkdown: "Detailed browser summary",
      openTabsPreview: [
        {
          tabId: 42,
          title: "Example article",
          url: "https://example.com/article",
          active: true,
        },
      ],
      capturedAt: "2026-04-23T09:30:00.000Z",
    };
    const prompt: PromptEnvelope = {
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Explain this page",
      context,
    };

    const contextPath = await createBrowserContextFileReference({
      cwd: rootDir,
      sessionId: prompt.sessionId,
      turnId: "turn-1",
      context,
    });
    const promptText = buildPromptText(prompt, { browserContextPath: contextPath });

    expect(contextPath.startsWith(join(rootDir, ".browser-acp", "tmp"))).toBe(true);
    expect(existsSync(contextPath)).toBe(true);
    expect(readFileSync(contextPath, "utf8")).toContain("Important selection");
    expect(promptText).toContain(contextPath);
    expect(promptText).toContain("User request:\nExplain this page");
    expect(promptText).not.toContain("Detailed browser summary");
    expect(promptText).not.toContain("You are a local CLI agent running on the user's machine through Browser ACP.");
  });

  it("keeps runtime instructions out of the prompt unless an agent requires a fallback", () => {
    const prompt: PromptEnvelope = {
      sessionId: "session-1",
      agentId: "agent-1",
      text: "Who are you?",
      context: {
        tabId: 1,
        url: "https://example.com",
        title: "Example",
        selectionText: "",
        summaryMarkdown: "",
        openTabsPreview: [],
        capturedAt: "2026-04-23T09:30:00.000Z",
      },
    };

    expect(buildPromptText(prompt)).not.toContain("Browser ACP Runtime Instructions");
    expect(
      buildPromptText(prompt, {
        promptPrefix: "# Browser ACP Runtime Instructions\nUse local tools when available.",
      }),
    ).toContain("Browser ACP Runtime Instructions");
  });
});
