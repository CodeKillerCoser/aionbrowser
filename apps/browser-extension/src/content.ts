import { capturePageContextInPage } from "./pageCapture";
import type { BackgroundRequest, SelectionActionType } from "./messages";

declare global {
  interface Window {
    __browserAcpSelectionMenuCleanup__?: () => void;
  }
}

const QUICK_ACTIONS: Array<{ action: SelectionActionType; label: string }> = [
  { action: "explain", label: "解释" },
  { action: "search", label: "搜索" },
  { action: "examples", label: "提供样例" },
];

let selectionMenu: HTMLDivElement | null = null;
let selectionText = "";

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

function dispatchSelectionAction(action: SelectionActionType): void {
  if (selectionText.trim().length === 0) {
    closeSelectionMenu();
    return;
  }

  const message: BackgroundRequest = {
    type: "browser-acp/trigger-selection-action",
    action,
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

  for (const quickAction of QUICK_ACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = quickAction.label;
    button.dataset.browserAcpSelectionAction = quickAction.action;
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
      dispatchSelectionAction(quickAction.action);
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
    const nextSelectionText = capturePageContextInPage().selectionText.trim();
    if (nextSelectionText.length === 0) {
      closeSelectionMenu();
      return;
    }

    selectionText = nextSelectionText;
    const menu = ensureSelectionMenu();
    positionSelectionMenu(menu, event.clientX, event.clientY);
  }, 0);
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

  window.__browserAcpSelectionMenuCleanup__ = () => {
    document.removeEventListener("mouseup", scheduleSelectionMenu, true);
    document.removeEventListener("mousedown", handleDocumentMouseDown, true);
    document.removeEventListener("keydown", handleEscape, true);
    window.removeEventListener("scroll", closeSelectionMenu, true);
    window.removeEventListener("load", publishPageContext);
    closeSelectionMenu();
  };
}

installSelectionQuickActions();
publishPageContext();
