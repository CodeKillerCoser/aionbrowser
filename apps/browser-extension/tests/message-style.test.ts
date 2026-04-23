import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(__dirname, "../src/sidepanel/styles.css");
const distAssetsPath = resolve(__dirname, "../dist/assets");

function lastRuleFor(styles: string, selector: string): string {
  const marker = `\n${selector} {`;
  const start = styles.lastIndexOf(marker);

  if (start === -1) {
    return "";
  }

  const bodyStart = start + marker.length;
  const end = styles.indexOf("}", bodyStart);

  return end === -1 ? "" : styles.slice(bodyStart, end);
}

function lastMinifiedRuleFor(styles: string, selector: string): string {
  const marker = `${selector}{`;
  const start = styles.lastIndexOf(marker);

  if (start === -1) {
    return "";
  }

  const bodyStart = start + marker.length;
  const end = styles.indexOf("}", bodyStart);

  return end === -1 ? "" : styles.slice(bodyStart, end);
}

describe("message visual style contract", () => {
  it("uses an open assistant reading surface and a full user prompt block", () => {
    const styles = readFileSync(stylesPath, "utf8");
    const transcriptScroll = lastRuleFor(styles, ".browser-acp-transcript-scroll");
    const transcriptBody = lastRuleFor(styles, ".browser-acp-thread-message-body");
    const assistantShell = lastRuleFor(styles, ".browser-acp-thread-message-assistant");
    const assistantBody = lastRuleFor(
      styles,
      ".browser-acp-thread-message-assistant .browser-acp-thread-message-body",
    );
    const userShell = lastRuleFor(styles, ".browser-acp-thread-message-user");
    const userBody = lastRuleFor(styles, ".browser-acp-thread-message-user .browser-acp-thread-message-body");
    const thoughtRow = lastRuleFor(styles, ".browser-acp-system-row-thought");
    const inlineCode = lastRuleFor(styles, ".browser-acp-inline-code");
    const codeBlock = lastRuleFor(styles, ".browser-acp-markdown pre");

    expect(transcriptScroll).toContain("gap: 10px");
    expect(transcriptScroll).toContain("padding: 12px clamp(18px, 5vw, 64px) 24px");
    expect(transcriptBody).toContain("font-size: 0.86rem");
    expect(transcriptBody).toContain("font-weight: 400");
    expect(transcriptBody).toContain("line-height: 1.72");
    expect(assistantShell).toContain("width: min(1120px, 100%)");
    expect(assistantShell).toContain("margin-inline: auto");
    expect(assistantBody).toContain("background: transparent");
    expect(assistantBody).toContain("border: 0");
    expect(assistantBody).toContain("padding: 8px 0");
    expect(assistantBody).toContain("box-shadow: none");
    expect(userShell).toContain("width: min(1120px, 100%)");
    expect(userShell).toContain("align-self: center");
    expect(userShell).toContain("margin-inline: auto");
    expect(userBody).toContain("border: 0");
    expect(userBody).toContain("background: #f4f4f2");
    expect(userBody).toContain("color: #202124");
    expect(userBody).toContain("align-self: flex-end");
    expect(userBody).toContain("width: fit-content");
    expect(userBody).toContain("max-width: min(560px, 100%)");
    expect(userBody).toContain("padding: 10px 16px");
    expect(userBody).toContain("box-shadow: none");
    expect(thoughtRow).toContain("width: min(1120px, 100%)");
    expect(thoughtRow).toContain("margin-inline: auto");
    expect(thoughtRow).toContain("padding: 0");
    expect(thoughtRow).toContain("margin-top: -2px");
    expect(inlineCode).toContain("background: #f1f1ef");
    expect(inlineCode).toContain("border: 0");
    expect(codeBlock).toContain("background: #f4f4f2");
    expect(codeBlock).toContain("border: 0");
    expect(codeBlock).toContain("border-radius: 16px");
  });

  it("keeps the built sidepanel stylesheet in sync when dist exists", () => {
    if (!existsSync(distAssetsPath)) {
      return;
    }

    const sidepanelCss = readdirSync(distAssetsPath).find(
      (fileName) => fileName.startsWith("sidepanel-") && fileName.endsWith(".css"),
    );

    expect(sidepanelCss).toBeTruthy();

    const styles = readFileSync(resolve(distAssetsPath, sidepanelCss as string), "utf8");

    const rootVars = lastMinifiedRuleFor(styles, ":root,.browser-acp-panel-root");
    const userShell = lastMinifiedRuleFor(styles, ".browser-acp-thread-message-user");
    const userBody = lastMinifiedRuleFor(styles, ".browser-acp-thread-message-user .browser-acp-thread-message-body");

    expect(rootVars).toContain("--browser-acp-user: #f4f4f2");
    expect(rootVars).not.toContain("--browser-acp-user: #d8dee7");
    expect(styles).toContain("width:min(1120px,100%)");
    expect(userShell).toContain("width:min(1120px,100%)");
    expect(userShell).toContain("align-self:center");
    expect(userBody).toContain("background:#f4f4f2");
    expect(userBody).toContain("align-self:flex-end");
    expect(userBody).toContain("width:fit-content");
    expect(userBody).toContain("padding:10px 16px");
    expect(userBody).not.toContain("padding:7px 10px");
  });
});
