import { capturePageContextInPage } from "./pageCapture";
import { DEFAULT_PAGE_TASK_TEMPLATES, sanitizePageTaskTemplates } from "@browser-acp/client-core";
import type { PageTaskTemplate } from "@browser-acp/shared-types";
import type { BackgroundRequest, BackgroundRuntimeMessage } from "./messages";

declare global {
  interface Window {
    __browserAcpSelectionMenuCleanup__?: () => void;
  }
}

let selectionMenu: HTMLDivElement | null = null;
let selectionText = "";
let pageTaskTemplates: PageTaskTemplate[] = DEFAULT_PAGE_TASK_TEMPLATES;

function publishPageContext(): void {
  const message: BackgroundRequest = {
    type: "browser-acp/context-update",
    payload: capturePageContextInPage(),
  };

  void chrome.runtime.sendMessage(message);
}

function closeSelectionMenu(): void {
  selectionText = "";
  selectionMenu?.remove();
  selectionMenu = null;
}

function dispatchSelectionAction(templateId: string): void {
  if (selectionText.trim().length === 0) {
    closeSelectionMenu();
    return;
  }

  const message: BackgroundRequest = {
    type: "browser-acp/trigger-selection-action",
    templateId,
    selectionText,
  };

  closeSelectionMenu();
  void chrome.runtime.sendMessage(message);
}

function ensureSelectionMenu(): HTMLDivElement {
  if (selectionMenu) {
    return selectionMenu;
  }

  const menu = document.createElement("div");
  menu.dataset.browserAcpSelectionMenu = "true";
  menu.style.position = "fixed";
  menu.style.zIndex = "2147483647";
  menu.style.display = "flex";
  menu.style.gap = "6px";
  menu.style.padding = "6px";
  menu.style.border = "1px solid rgba(15, 23, 42, 0.12)";
  menu.style.borderRadius = "10px";
  menu.style.background = "#ffffff";
  menu.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.18)";
  menu.style.fontFamily = "system-ui, sans-serif";
  menu.style.alignItems = "center";

  for (const quickAction of pageTaskTemplates.filter((template) => template.enabled)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = quickAction.title;
    button.dataset.browserAcpSelectionAction = quickAction.id;
    button.style.border = "0";
    button.style.borderRadius = "8px";
    button.style.padding = "6px 10px";
    button.style.background = "#f8fafc";
    button.style.color = "#0f172a";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
    button.style.whiteSpace = "nowrap";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchSelectionAction(quickAction.id);
    });
    menu.appendChild(button);
  }

  (document.body ?? document.documentElement).appendChild(menu);
  selectionMenu = menu;
  return menu;
}

function positionSelectionMenu(menu: HTMLDivElement, x: number, y: number): void {
  menu.style.left = "0px";
  menu.style.top = "0px";

  const margin = 12;
  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = Math.min(Math.max(margin, x), maxLeft);
  const top = Math.min(Math.max(margin, y + 10), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function scheduleSelectionMenu(event: MouseEvent): void {
  window.setTimeout(() => {
    void showSelectionMenu(event);
  }, 0);
}

async function showSelectionMenu(event: MouseEvent): Promise<void> {
  await refreshPageTaskTemplates();
  const nextSelectionText = capturePageContextInPage().selectionText.trim();
  if (nextSelectionText.length === 0) {
    closeSelectionMenu();
    return;
  }

  selectionText = nextSelectionText;
  const menu = ensureSelectionMenu();
  positionSelectionMenu(menu, event.clientX, event.clientY);
}

function refreshPageTaskTemplates(): Promise<void> {
  return new Promise((resolve) => {
    const message: BackgroundRequest = {
      type: "browser-acp/list-page-task-templates",
    };

    chrome.runtime.sendMessage(message, (response) => {
      const nextTemplates = sanitizePageTaskTemplates(response);
      const changed = JSON.stringify(nextTemplates) !== JSON.stringify(pageTaskTemplates);
      pageTaskTemplates = nextTemplates;
      if (changed) {
        selectionMenu?.remove();
        selectionMenu = null;
      }
      resolve();
    });
  });
}

function handleDocumentMouseDown(event: MouseEvent): void {
  if (!selectionMenu) {
    return;
  }

  if (event.target instanceof Node && selectionMenu.contains(event.target)) {
    return;
  }

  closeSelectionMenu();
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeSelectionMenu();
  }
}

function installSelectionQuickActions(): void {
  window.__browserAcpSelectionMenuCleanup__?.();

  document.addEventListener("mouseup", scheduleSelectionMenu, true);
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  document.addEventListener("keydown", handleEscape, true);
  window.addEventListener("scroll", closeSelectionMenu, true);
  window.addEventListener("load", publishPageContext);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  window.__browserAcpSelectionMenuCleanup__ = () => {
    document.removeEventListener("mouseup", scheduleSelectionMenu, true);
    document.removeEventListener("mousedown", handleDocumentMouseDown, true);
    document.removeEventListener("keydown", handleEscape, true);
    window.removeEventListener("scroll", closeSelectionMenu, true);
    window.removeEventListener("load", publishPageContext);
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    closeSelectionMenu();
  };
}

function handleRuntimeMessage(message: BackgroundRuntimeMessage): void {
  if (message.type !== "browser-acp/page-task-templates-changed") {
    return;
  }

  pageTaskTemplates = sanitizePageTaskTemplates(message.templates);
  selectionMenu?.remove();
  selectionMenu = null;
}

installSelectionQuickActions();
publishPageContext();
