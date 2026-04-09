import { describe, expect, it } from "vitest";
import { capturePageContextInPage } from "../src/pageCapture";

describe("capturePageContextInPage", () => {
  it("captures the current document title, selection, and summary", () => {
    document.title = "Captured page";
    document.body.innerHTML = `
      <main>
        <p id="target">Captured paragraph for the Browser ACP page snapshot.</p>
      </main>
    `;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("target")!);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const payload = capturePageContextInPage();

    expect(payload.title).toBe("Captured page");
    expect(payload.selectionText).toContain("Captured paragraph");
    expect(payload.summaryMarkdown).toContain("Captured paragraph");
  });

  it("can run as an injected script without module-scoped helpers", () => {
    document.title = "Injected page";
    document.body.innerHTML = `
      <main>
        <p id="target">Injected paragraph for the Browser ACP page snapshot.</p>
      </main>
    `;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("target")!);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const injectedCapture = globalThis.eval(
      `(${capturePageContextInPage.toString()})`,
    ) as typeof capturePageContextInPage;

    const payload = injectedCapture();

    expect(payload.title).toBe("Injected page");
    expect(payload.selectionText).toContain("Injected paragraph");
    expect(payload.summaryMarkdown).toContain("Injected paragraph");
  });

  it("captures selected text from a focused CodeMirror editor when injected into the page", () => {
    document.title = "Injected editor page";
    document.body.innerHTML = `
      <main>
        <div class="CodeMirror" id="editor-shell">
          <textarea id="editor-input"></textarea>
        </div>
      </main>
    `;

    const shell = document.getElementById("editor-shell") as HTMLDivElement & {
      CodeMirror?: { getSelection: () => string };
    };
    shell.CodeMirror = {
      getSelection: () => "Beta",
    };

    const input = document.getElementById("editor-input") as HTMLTextAreaElement;
    input.focus();

    const injectedCapture = globalThis.eval(
      `(${capturePageContextInPage.toString()})`,
    ) as typeof capturePageContextInPage;

    const payload = injectedCapture();

    expect(payload.selectionText).toBe("Beta");
  });
});
