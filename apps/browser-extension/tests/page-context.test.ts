import { describe, expect, it } from "vitest";
import { buildPageContextPayload, extractReadableSummary } from "../src/pageContext";

describe("pageContext helpers", () => {
  it("extracts a readable summary from the main content area", () => {
    document.body.innerHTML = `
      <main>
        <h1>Browser ACP</h1>
        <p>This is the first paragraph with enough content to count toward the generated summary output.</p>
        <p>This is the second paragraph, which should also be included in the summary because it contains useful detail.</p>
      </main>
    `;

    expect(extractReadableSummary(document)).toContain("first paragraph");
    expect(extractReadableSummary(document)).toContain("second paragraph");
  });

  it("captures page title, url, selected text, and summary in a payload", () => {
    document.title = "Example post";
    document.body.innerHTML = `
      <article>
        <p id="target">Selected paragraph for the reading companion.</p>
      </article>
    `;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("target")!);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const payload = buildPageContextPayload(document, new URL("https://example.com/article"));

    expect(payload.title).toBe("Example post");
    expect(payload.url).toBe("https://example.com/article");
    expect(payload.selectionText).toContain("Selected paragraph");
    expect(payload.summaryMarkdown).toContain("Selected paragraph");
  });

  it("captures selected text from the focused textarea when the page selection is empty", () => {
    document.title = "Editor";
    document.body.innerHTML = `
      <main>
        <textarea id="editor">Alpha Beta Gamma</textarea>
      </main>
    `;

    const editor = document.getElementById("editor") as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(6, 10);

    const selection = window.getSelection();
    selection?.removeAllRanges();

    const payload = buildPageContextPayload(document, new URL("https://example.com/editor"));

    expect(payload.selectionText).toBe("Beta");
  });

  it("captures selected text from a focused input nested inside an open shadow root", () => {
    document.title = "Shadow editor";
    document.body.innerHTML = "<main><div id='host'></div></main>";

    const host = document.getElementById("host") as HTMLDivElement;
    const shadowRoot = host.attachShadow({ mode: "open" });
    const editor = document.createElement("input");
    editor.type = "text";
    editor.value = "Alpha Beta Gamma";
    shadowRoot.appendChild(editor);

    editor.focus();
    editor.setSelectionRange(6, 10);

    const payload = buildPageContextPayload(document, new URL("https://example.com/shadow-editor"));

    expect(payload.selectionText).toBe("Beta");
  });

  it("captures selected text from a focused CodeMirror editor", () => {
    document.title = "CodeMirror editor";
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

    const payload = buildPageContextPayload(document, new URL("https://example.com/codemirror-editor"));

    expect(payload.selectionText).toBe("Beta");
  });
});
