import { describe, expect, it } from "vitest";
import type { BrowserContextBundle, PageTaskTemplate } from "@browser-acp/shared-types";
import { renderPageTaskPrompt, sanitizePageTaskTemplates } from "../src/pageTaskTemplates";

const context: BrowserContextBundle = {
  tabId: 1,
  title: "Rust display example",
  url: "https://example.com/rust",
  selectionText: "impl Display for List",
  summaryMarkdown: "The page explains Display implementations.",
  openTabsPreview: [],
  capturedAt: "2026-04-27T00:00:00.000Z",
};

describe("page task templates", () => {
  it("renders page and selection variables into prompt text", () => {
    const template: PageTaskTemplate = {
      id: "explain",
      title: "解释选中内容",
      promptTemplate: "请解释 {{selectionText}}，页面是 {{pageTitle}}，链接 {{pageUrl}}。",
      enabled: true,
    };

    expect(renderPageTaskPrompt(template, context)).toBe(
      "请解释 impl Display for List，页面是 Rust display example，链接 https://example.com/rust。",
    );
  });

  it("keeps valid configured templates and falls back when none are usable", () => {
    const templates = sanitizePageTaskTemplates([
      {
        id: "custom",
        title: " 自定义 ",
        promptTemplate: " 处理 {{pageSummary}} ",
        enabled: true,
      },
      {
        id: "",
        title: "",
        promptTemplate: "",
        enabled: true,
      },
    ]);

    expect(templates).toEqual([
      {
        id: "custom",
        title: "自定义",
        promptTemplate: "处理 {{pageSummary}}",
        enabled: true,
      },
    ]);
    expect(sanitizePageTaskTemplates([]).length).toBeGreaterThan(0);
  });
});
