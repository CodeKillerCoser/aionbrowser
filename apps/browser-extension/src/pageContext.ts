import type { PageContextPayload } from "./messages";

const MAX_SUMMARY_LENGTH = 1200;
const INPUT_SELECTION_TYPES = new Set(["email", "search", "tel", "text", "url"]);
type ActiveRoot = Document | ShadowRoot;
type CodeMirrorHost = Element & {
  CodeMirror?: {
    getSelection?: () => string;
  };
};

function listActiveRoots(doc: Document): ActiveRoot[] {
  const roots: ActiveRoot[] = [doc];
  let currentRoot: ActiveRoot = doc;

  while (true) {
    const activeElement: Element | null = currentRoot.activeElement;
    if (!(activeElement instanceof Element) || !activeElement.shadowRoot) {
      return roots;
    }

    currentRoot = activeElement.shadowRoot;
    roots.push(currentRoot);
  }
}

function extractRootSelection(root: ActiveRoot): string {
  const selection = (root as ActiveRoot & { getSelection?: () => Selection | null }).getSelection?.();
  return selection?.toString().trim() ?? "";
}

function extractDeepSelectionText(doc: Document): string {
  for (const root of listActiveRoots(doc)) {
    const selectionText = extractRootSelection(root);
    if (selectionText.length > 0) {
      return selectionText;
    }
  }

  return "";
}

function extractDeepActiveElement(doc: Document): Element | null {
  const roots = listActiveRoots(doc);
  const deepestRoot = roots.at(-1);
  return deepestRoot?.activeElement ?? doc.activeElement;
}

export function extractReadableSummary(doc: Document): string {
  const root =
    doc.querySelector("article, main, [role='main']") ??
    doc.body ??
    doc.documentElement;

  const paragraphs = [...root.querySelectorAll("p")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => text.length > 0)
    .slice(0, 4);

  const fallback = root.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const summary = (paragraphs.length > 0 ? paragraphs.join("\n\n") : fallback).slice(0, MAX_SUMMARY_LENGTH);

  return summary;
}

function extractActiveElementSelection(doc: Document): string {
  const activeElement = extractDeepActiveElement(doc);
  if (activeElement instanceof HTMLTextAreaElement) {
    return activeElement.value
      .slice(activeElement.selectionStart ?? 0, activeElement.selectionEnd ?? 0)
      .trim();
  }

  if (activeElement instanceof HTMLInputElement && INPUT_SELECTION_TYPES.has(activeElement.type)) {
    return activeElement.value
      .slice(activeElement.selectionStart ?? 0, activeElement.selectionEnd ?? 0)
      .trim();
  }

  return "";
}

function extractCodeMirrorSelection(doc: Document): string {
  const candidates: Element[] = [];
  let current: Element | null = extractDeepActiveElement(doc);
  while (current) {
    candidates.push(current);
    current = current.parentElement;
  }

  const focusedCodeMirror = doc.querySelector(".CodeMirror-focused");
  if (focusedCodeMirror instanceof Element) {
    candidates.push(focusedCodeMirror);
  }

  for (const candidate of candidates) {
    const selectionText = (candidate as CodeMirrorHost).CodeMirror?.getSelection?.();
    if (typeof selectionText === "string" && selectionText.trim().length > 0) {
      return selectionText.trim();
    }
  }

  return "";
}

export function extractSelectionText(doc: Document): string {
  const pageSelection = extractDeepSelectionText(doc);
  if (pageSelection.length > 0) {
    return pageSelection;
  }

  const codeMirrorSelection = extractCodeMirrorSelection(doc);
  if (codeMirrorSelection.length > 0) {
    return codeMirrorSelection;
  }

  return extractActiveElementSelection(doc);
}

export function buildPageContextPayload(doc: Document, url = new URL(window.location.href)): PageContextPayload {
  return {
    url: url.toString(),
    title: doc.title || url.hostname,
    selectionText: extractSelectionText(doc),
    summaryMarkdown: extractReadableSummary(doc),
    hasFocus: doc.hasFocus(),
  };
}
