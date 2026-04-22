import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(__dirname, "../src/sidepanel/styles.css");

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

describe("message visual style contract", () => {
  it("keeps assistant messages lightweight and user messages in a compact technology gray bubble", () => {
    const styles = readFileSync(stylesPath, "utf8");
    const transcriptBody = lastRuleFor(styles, ".browser-acp-thread-message-body");
    const assistantBody = lastRuleFor(
      styles,
      ".browser-acp-thread-message-assistant .browser-acp-thread-message-body",
    );
    const userBody = lastRuleFor(styles, ".browser-acp-thread-message-user .browser-acp-thread-message-body");

    expect(transcriptBody).toContain("font-size: 0.88rem");
    expect(transcriptBody).toContain("font-weight: 400");
    expect(assistantBody).toContain("background: transparent");
    expect(assistantBody).toContain("border-color: transparent");
    expect(assistantBody).toContain("box-shadow: none");
    expect(userBody).toContain("border: 0");
    expect(userBody).toContain("background: #d8dee7");
    expect(userBody).toContain("color: #1d2430");
    expect(userBody).toContain("padding: 7px 10px");
    expect(userBody).toContain("box-shadow: none");
  });
});
