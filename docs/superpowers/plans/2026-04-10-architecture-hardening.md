# Browser ACP Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Browser ACP into a maintainable multi-package architecture with explicit module boundaries, centralized configuration, and minimal hardcoding while preserving the current Chrome native `sidePanel` behavior.

**Architecture:** Add a shared runtime-safe config package, clean the `shared-types` boundary, then split each app into thin entrypoints plus focused internal modules. Browser-specific and platform-specific behavior stays at the edge, while background/session/runtime logic moves into dedicated services with stable tests around message routing and config resolution.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Chrome Extensions API, Hono, ws, Node.js

---

## File Structure

### Shared Packages

- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/tests/config.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `apps/browser-extension/package.json`
- Modify: `apps/acp-daemon/package.json`
- Modify: `apps/native-host/package.json`
- Delete: `packages/shared-types/src/index.js`
- Delete: `packages/shared-types/src/index.js.map`
- Delete: `packages/shared-types/src/index.d.ts`
- Delete: `packages/shared-types/src/index.d.ts.map`

### Browser Extension

- Create: `apps/browser-extension/src/platform/chromeNativeHost.ts`
- Create: `apps/browser-extension/src/platform/chromeRuntime.ts`
- Create: `apps/browser-extension/src/platform/chromeSidePanel.ts`
- Create: `apps/browser-extension/src/platform/chromeStorage.ts`
- Create: `apps/browser-extension/src/platform/chromeTabs.ts`
- Create: `apps/browser-extension/src/context/activeContextService.ts`
- Create: `apps/browser-extension/src/context/contextState.ts`
- Create: `apps/browser-extension/src/context/frameContext.ts`
- Create: `apps/browser-extension/src/context/pageCapture.ts`
- Create: `apps/browser-extension/src/context/pageContext.ts`
- Create: `apps/browser-extension/src/debug/backgroundDebugLog.ts`
- Create: `apps/browser-extension/src/session/daemonClient.ts`
- Create: `apps/browser-extension/src/session/pendingSelectionActionService.ts`
- Create: `apps/browser-extension/src/ui/sidepanel/BrowserAcpPanel.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/AgentList.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/Composer.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/DebugPanel.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/SessionList.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/Transcript.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/usePanelBootstrap.ts`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/useSelectionActions.ts`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/useSessionSocket.ts`
- Modify: `apps/browser-extension/src/background.ts`
- Modify: `apps/browser-extension/src/content.ts`
- Modify: `apps/browser-extension/src/sidepanel/App.tsx`
- Modify: `apps/browser-extension/src/sidepanel/MarkdownMessage.tsx`
- Modify: `apps/browser-extension/src/sidepanel/bridge.ts`
- Modify: `apps/browser-extension/src/sidepanel/threadMessages.ts`
- Modify: `apps/browser-extension/tests/background.test.ts`
- Modify: `apps/browser-extension/tests/app.test.tsx`
- Modify: `apps/browser-extension/tests/bridge.test.ts`
- Modify: `apps/browser-extension/tests/page-context.test.ts`
- Modify: `apps/browser-extension/tests/page-capture.test.ts`

### ACP Daemon

- Create: `apps/acp-daemon/src/application/agentService.ts`
- Create: `apps/acp-daemon/src/application/sessionService.ts`
- Create: `apps/acp-daemon/src/config/daemonConfig.ts`
- Create: `apps/acp-daemon/src/http/daemonHttpServer.ts`
- Create: `apps/acp-daemon/src/storage/sessionStore.ts`
- Create: `apps/acp-daemon/src/ws/sessionWsGateway.ts`
- Modify: `apps/acp-daemon/src/index.ts`
- Modify: `apps/acp-daemon/src/server.ts`
- Modify: `apps/acp-daemon/src/session/sessionManager.ts`
- Modify: `apps/acp-daemon/tests/daemon-server.integration.test.ts`
- Modify: `apps/acp-daemon/tests/session-manager.test.ts`
- Modify: `apps/acp-daemon/tests/session-store.test.ts`

### Native Host

- Create: `apps/native-host/src/bootstrap/daemonBootstrap.ts`
- Create: `apps/native-host/src/config/nativeHostConfig.ts`
- Create: `apps/native-host/src/platform/chromePaths.ts`
- Create: `apps/native-host/src/platform/macosShell.ts`
- Create: `apps/native-host/src/protocol/nativeMessagingProtocol.ts`
- Modify: `apps/native-host/src/index.ts`
- Modify: `apps/native-host/src/installManifest.ts`
- Modify: `apps/native-host/tests/daemon-bootstrap.test.ts`
- Modify: `apps/native-host/tests/install-manifest.test.ts`

### Cleanup

- Modify: `.gitignore`
- Delete: `apps/browser-extension/src/sidepanel/index.html`
- Modify: `apps/browser-extension/sidepanel.html`

---

### Task 1: Add Shared Runtime Config and Clean the Shared Boundary

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/tests/config.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `apps/browser-extension/package.json`
- Modify: `apps/acp-daemon/package.json`
- Modify: `apps/native-host/package.json`
- Delete: `packages/shared-types/src/index.js`
- Delete: `packages/shared-types/src/index.js.map`
- Delete: `packages/shared-types/src/index.d.ts`
- Delete: `packages/shared-types/src/index.d.ts.map`

- [ ] **Step 1: Write the failing config boundary test**

```ts
// packages/config/tests/config.test.ts
import { describe, expect, it } from "vitest";
import {
  BROWSER_ACP_NATIVE_HOST_NAME,
  DAEMON_HOST,
  DAEMON_LOG_FILE_NAME,
  EXTENSION_STORAGE_KEYS,
  SELECTION_ACTION_PROMPTS,
  SIDEPANEL_DEFAULT_PATH,
  createDaemonBaseUrl,
} from "../src/index";

describe("shared config", () => {
  it("exposes one authoritative runtime-safe constant set", () => {
    expect(BROWSER_ACP_NATIVE_HOST_NAME).toBe("com.browser_acp.host");
    expect(DAEMON_HOST).toBe("127.0.0.1");
    expect(createDaemonBaseUrl(57603)).toBe("http://127.0.0.1:57603");
    expect(DAEMON_LOG_FILE_NAME).toBe("daemon.log");
    expect(SIDEPANEL_DEFAULT_PATH).toBe("sidepanel.html");
    expect(EXTENSION_STORAGE_KEYS.debugLogs).toBe("browser-acp-debug-logs");
    expect(SELECTION_ACTION_PROMPTS.explain("Beta")).toContain("Beta");
  });
});
```

- [ ] **Step 2: Run the package test to verify it fails because the package does not exist yet**

Run: `pnpm --filter @browser-acp/config test`

Expected: pnpm fails with `No projects matched the filters` or `Missing package`, proving the config package is not present yet.

- [ ] **Step 3: Add the new shared config package with the initial constant surface**

```json
// packages/config/package.json
{
  "name": "@browser-acp/config",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

```json
// packages/config/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts"
  ]
}
```

```ts
// packages/config/src/index.ts
export const BROWSER_ACP_NATIVE_HOST_NAME = "com.browser_acp.host";
export const DAEMON_PROTOCOL = "http";
export const DAEMON_HOST = "127.0.0.1";
export const DAEMON_LOG_FILE_NAME = "daemon.log";
export const DAEMON_STATE_FILE_NAME = "daemon-state.json";
export const SIDEPANEL_DEFAULT_PATH = "sidepanel.html";

export const EXTENSION_STORAGE_KEYS = {
  debugLogs: "browser-acp-debug-logs",
  pendingSelectionAction: "browser-acp-pending-selection-action",
} as const;

export const SELECTION_ACTION_PROMPTS = {
  explain: (selectionText: string) =>
    `请解释下面这段内容，结合当前页面上下文说明重点和含义：\\n\\n${selectionText.trim()}`,
  search: (selectionText: string) =>
    `请基于下面这段内容，提炼搜索关键词、核心问题，并给出后续搜索方向：\\n\\n${selectionText.trim()}`,
  examples: (selectionText: string) =>
    `请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\\n\\n${selectionText.trim()}`,
} as const;

export function createDaemonBaseUrl(port: number): string {
  return `${DAEMON_PROTOCOL}://${DAEMON_HOST}:${port}`;
}
```

- [ ] **Step 4: Update workspace resolution so all apps consume the same exported surface**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "paths": {
      "@browser-acp/config": [
        "packages/config/src/index.ts"
      ],
      "@browser-acp/shared-types": [
        "packages/shared-types/src/index.ts"
      ]
    }
  }
}
```

```json
// apps/browser-extension/package.json
{
  "dependencies": {
    "@browser-acp/config": "workspace:*",
    "@browser-acp/shared-types": "workspace:*"
  }
}
```

```json
// apps/acp-daemon/package.json
{
  "dependencies": {
    "@browser-acp/config": "workspace:*",
    "@browser-acp/shared-types": "workspace:*"
  }
}
```

```json
// apps/native-host/package.json
{
  "dependencies": {
    "@browser-acp/config": "workspace:*",
    "@browser-acp/shared-types": "workspace:*"
  }
}
```

- [ ] **Step 5: Remove the generated artifacts from `shared-types/src` so source and build outputs stop drifting**

Run:

```bash
rm packages/shared-types/src/index.js \
  packages/shared-types/src/index.js.map \
  packages/shared-types/src/index.d.ts \
  packages/shared-types/src/index.d.ts.map
```

Expected: only `packages/shared-types/src/index.ts` remains under `src/`.

- [ ] **Step 6: Run the focused verification for the new shared boundary**

Run:

```bash
pnpm --filter @browser-acp/config test
pnpm --filter @browser-acp/config typecheck
pnpm --filter @browser-acp/shared-types typecheck
```

Expected:
- the new config test passes
- the config package typechecks
- `shared-types` still typechecks with only source TypeScript in `src/`

- [ ] **Step 7: Commit the shared boundary change**

Run:

```bash
git add \
  packages/config \
  tsconfig.base.json \
  apps/browser-extension/package.json \
  apps/acp-daemon/package.json \
  apps/native-host/package.json \
  packages/shared-types/src
git commit -m $'feat(config): 提取共享运行时配置\n\nRefs: #66486125'
```

Expected: one commit that introduces the shared config package and removes generated artifacts from `shared-types/src`.

---

### Task 2: Split the Extension Background Worker into Focused Services

**Files:**
- Create: `apps/browser-extension/src/platform/chromeNativeHost.ts`
- Create: `apps/browser-extension/src/platform/chromeRuntime.ts`
- Create: `apps/browser-extension/src/platform/chromeSidePanel.ts`
- Create: `apps/browser-extension/src/platform/chromeStorage.ts`
- Create: `apps/browser-extension/src/platform/chromeTabs.ts`
- Create: `apps/browser-extension/src/context/activeContextService.ts`
- Create: `apps/browser-extension/src/context/contextState.ts`
- Create: `apps/browser-extension/src/context/frameContext.ts`
- Create: `apps/browser-extension/src/context/pageCapture.ts`
- Create: `apps/browser-extension/src/context/pageContext.ts`
- Create: `apps/browser-extension/src/debug/backgroundDebugLog.ts`
- Create: `apps/browser-extension/src/session/daemonClient.ts`
- Create: `apps/browser-extension/src/session/pendingSelectionActionService.ts`
- Modify: `apps/browser-extension/src/background.ts`
- Modify: `apps/browser-extension/tests/background.test.ts`
- Modify: `apps/browser-extension/tests/page-context.test.ts`
- Modify: `apps/browser-extension/tests/page-capture.test.ts`

- [ ] **Step 1: Write a failing router test that proves the background entry delegates instead of owning every concern**

```ts
// apps/browser-extension/tests/background.test.ts
import { describe, expect, it, vi } from "vitest";
import { createBackgroundRouter } from "../src/background";

describe("background router", () => {
  it("queues selection actions through the pending action service", async () => {
    const queueSelectionAction = vi.fn().mockResolvedValue({ ok: true });
    const router = createBackgroundRouter({
      queueSelectionAction,
      ensureDaemon: vi.fn(),
      listAgents: vi.fn(),
      listSessions: vi.fn(),
      getActiveContext: vi.fn(),
      getDebugState: vi.fn(),
      createSession: vi.fn(),
      claimPendingSelectionAction: vi.fn(),
      updateContextFromPage: vi.fn(),
    });

    const result = await router.handle(
      {
        type: "browser-acp/trigger-selection-action",
        action: "explain",
        selectionText: "Alpha",
      },
      { tab: { id: 1, windowId: 2 } } as chrome.runtime.MessageSender,
    );

    expect(queueSelectionAction).toHaveBeenCalledWith("explain", "Alpha", { tabId: 1, windowId: 2 });
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because `createBackgroundRouter` does not exist yet**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/background.test.ts`

Expected: FAIL with a missing export or a wrong implementation shape in `background.ts`.

- [ ] **Step 3: Extract the platform and service modules with one responsibility each**

```ts
// apps/browser-extension/src/session/pendingSelectionActionService.ts
import { EXTENSION_STORAGE_KEYS, SELECTION_ACTION_PROMPTS } from "@browser-acp/config";
import type { PendingSelectionAction, SelectionActionType } from "../messages";

export function createPendingSelectionActionService(deps: {
  openSidePanel(windowId?: number): Promise<void>;
  persist(action: PendingSelectionAction | null): Promise<void>;
  notifySelectionActionReady(): Promise<void>;
  now?: () => string;
  randomId?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  return {
    async queue(action: SelectionActionType, selectionText: string, target: { tabId?: number; windowId?: number }) {
      const nextAction: PendingSelectionAction = {
        id: randomId(),
        action,
        selectionText,
        promptText: SELECTION_ACTION_PROMPTS[action](selectionText),
        createdAt: now(),
      };

      await deps.openSidePanel(target.windowId);
      await deps.persist(nextAction);
      await deps.notifySelectionActionReady();
      return { ok: true as const, action: nextAction };
    },
  };
}
```

```ts
// apps/browser-extension/src/session/daemonClient.ts
import { createDaemonBaseUrl } from "@browser-acp/config";
import type { ConversationSummary, NativeHostBootstrapResponse, ResolvedAgent } from "@browser-acp/shared-types";

export function createDaemonClient(fetchImpl: typeof fetch = fetch) {
  return {
    async listAgents(bootstrap: NativeHostBootstrapResponse): Promise<ResolvedAgent[]> {
      const response = await fetchImpl(`${createDaemonBaseUrl(bootstrap.port)}/agents`, {
        headers: { Authorization: `Bearer ${bootstrap.token}` },
      });
      return (await response.json()) as ResolvedAgent[];
    },
    async listSessions(bootstrap: NativeHostBootstrapResponse): Promise<ConversationSummary[]> {
      const response = await fetchImpl(`${createDaemonBaseUrl(bootstrap.port)}/sessions`, {
        headers: { Authorization: `Bearer ${bootstrap.token}` },
      });
      return (await response.json()) as ConversationSummary[];
    },
  };
}
```

```ts
// apps/browser-extension/src/background.ts
export function createBackgroundRouter(services: {
  queueSelectionAction: (
    action: SelectionActionType,
    selectionText: string,
    target: { tabId?: number; windowId?: number },
  ) => Promise<{ ok: true }>;
  ensureDaemon: () => Promise<NativeHostBootstrapResponse>;
  listAgents: () => Promise<ResolvedAgent[]>;
  listSessions: () => Promise<ConversationSummary[]>;
  getActiveContext: () => Promise<BrowserContextBundle>;
  getDebugState: () => Promise<BackgroundDebugState>;
  createSession: (agentId: string, context: BrowserContextBundle) => Promise<ConversationSummary>;
  claimPendingSelectionAction: () => Promise<PendingSelectionAction | null>;
  updateContextFromPage: (
    payload: PageContextPayload,
    sender: chrome.runtime.MessageSender,
  ) => Promise<{ ok: true }>;
}) {
  return {
    async handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender) {
      if (message.type === "browser-acp/trigger-selection-action") {
        return services.queueSelectionAction(message.action, message.selectionText, {
          tabId: sender.tab?.id,
          windowId: sender.tab?.windowId,
        });
      }
      return { ok: false, error: "Unsupported message" };
    },
  };
}
```

- [ ] **Step 4: Move page-context helpers under the `context/` folder and rewire imports**

```ts
// apps/browser-extension/src/context/index usage inside background.ts
import { resolveSelectionText } from "./context/contextState";
import { mergeFramePageContexts } from "./context/frameContext";
import { capturePageContextInPage } from "./context/pageCapture";
```

Expected: `background.ts` becomes a composition root instead of a utility dump.

- [ ] **Step 5: Re-run the focused extension verification**

Run:

```bash
pnpm --filter @browser-acp/browser-extension test -- --run \
  tests/background.test.ts \
  tests/page-context.test.ts \
  tests/page-capture.test.ts
pnpm --filter @browser-acp/browser-extension typecheck
```

Expected:
- the background router test passes
- page capture/context tests still pass after the import move
- extension typecheck stays green

- [ ] **Step 6: Commit the background split**

Run:

```bash
git add apps/browser-extension/src apps/browser-extension/tests
git commit -m $'refactor(extension): 拆分后台服务与平台桥接\n\nRefs: #66486125'
```

Expected: one commit that isolates platform access, daemon calls, debug logging, and pending selection actions.

---

### Task 3: Split the Side Panel Into Hooks and Presentational Components

**Files:**
- Create: `apps/browser-extension/src/ui/sidepanel/BrowserAcpPanel.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/AgentList.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/Composer.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/DebugPanel.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/SessionList.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/components/Transcript.tsx`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/usePanelBootstrap.ts`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/useSelectionActions.ts`
- Create: `apps/browser-extension/src/ui/sidepanel/hooks/useSessionSocket.ts`
- Modify: `apps/browser-extension/src/sidepanel/App.tsx`
- Modify: `apps/browser-extension/src/sidepanel/MarkdownMessage.tsx`
- Modify: `apps/browser-extension/src/sidepanel/bridge.ts`
- Modify: `apps/browser-extension/src/sidepanel/threadMessages.ts`
- Modify: `apps/browser-extension/tests/app.test.tsx`
- Modify: `apps/browser-extension/tests/bridge.test.ts`

- [ ] **Step 1: Write a failing panel bootstrap test that locks the component boundary**

```tsx
// apps/browser-extension/tests/app.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserAcpPanel } from "../src/ui/sidepanel/BrowserAcpPanel";

describe("BrowserAcpPanel", () => {
  it("loads bootstrap data through the bootstrap hook", async () => {
    const bridge = {
      ensureDaemon: vi.fn().mockResolvedValue({ ok: true, port: 57603, token: "t", pid: 1, logPath: "/tmp/x" }),
      listAgents: vi.fn().mockResolvedValue([{ id: "qoder-cli", name: "Qoder CLI", status: "launchable" }]),
      listSessions: vi.fn().mockResolvedValue([]),
      getActiveContext: vi.fn().mockResolvedValue({
        tabId: 1,
        url: "https://example.com",
        title: "Example",
        selectionText: "",
        summaryMarkdown: "",
        openTabsPreview: [],
        capturedAt: "2026-04-10T00:00:00.000Z",
      }),
      subscribeToActiveContext: vi.fn().mockReturnValue(() => {}),
      claimPendingSelectionAction: vi.fn().mockResolvedValue(null),
      subscribeToSelectionActions: vi.fn().mockReturnValue(() => {}),
      getDebugState: vi.fn().mockResolvedValue(null),
      createSession: vi.fn(),
      connectSession: vi.fn(),
    } as any;

    render(<BrowserAcpPanel bridge={bridge} />);

    await waitFor(() => expect(bridge.ensureDaemon).toHaveBeenCalled());
    expect(screen.getByText("Qoder CLI")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the UI test and confirm it fails before the split**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/app.test.tsx`

Expected: FAIL because `BrowserAcpPanel` is still buried inside `src/sidepanel/App.tsx`.

- [ ] **Step 3: Extract the hooks and components while keeping the bridge contract stable**

```tsx
// apps/browser-extension/src/ui/sidepanel/hooks/usePanelBootstrap.ts
import { useEffect, useState } from "react";
import type { BrowserContextBundle, ConversationSummary, NativeHostBootstrapResponse, ResolvedAgent } from "@browser-acp/shared-types";
import type { BackgroundDebugState } from "../../messages";
import type { BrowserAcpBridge } from "../../sidepanel/App";

export function usePanelBootstrap(bridge: BrowserAcpBridge) {
  const [bootstrap, setBootstrap] = useState<NativeHostBootstrapResponse | null>(null);
  const [agents, setAgents] = useState<ResolvedAgent[]>([]);
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [context, setContext] = useState<BrowserContextBundle | null>(null);
  const [debugState, setDebugState] = useState<BackgroundDebugState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const nextBootstrap = await bridge.ensureDaemon();
      const [nextAgents, nextSessions, nextContext, nextDebugState] = await Promise.all([
        bridge.listAgents(nextBootstrap),
        bridge.listSessions(nextBootstrap),
        bridge.getActiveContext(),
        bridge.getDebugState(),
      ]);

      if (cancelled) {
        return;
      }

      setBootstrap(nextBootstrap);
      setAgents(nextAgents);
      setSessions(nextSessions);
      setContext(nextContext);
      setDebugState(nextDebugState);
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  return { bootstrap, agents, sessions, context, debugState };
}
```

```tsx
// apps/browser-extension/src/ui/sidepanel/BrowserAcpPanel.tsx
import { usePanelBootstrap } from "./hooks/usePanelBootstrap";
import { AgentList } from "./components/AgentList";

export function BrowserAcpPanel({ bridge }: { bridge: BrowserAcpBridge }) {
  const { agents } = usePanelBootstrap(bridge);

  return (
    <div className="browser-acp-panel-root">
      <AgentList agents={agents} />
    </div>
  );
}
```

```tsx
// apps/browser-extension/src/sidepanel/App.tsx
import { createChromeBridge } from "./bridge";
import { BrowserAcpPanel } from "../ui/sidepanel/BrowserAcpPanel";

export function App() {
  return <BrowserAcpPanel bridge={createChromeBridge()} />;
}
```

- [ ] **Step 4: Keep Markdown rendering in the presentation layer and verify the message component still supports code blocks**

Run:

```bash
pnpm --filter @browser-acp/browser-extension test -- --run \
  tests/app.test.tsx \
  tests/bridge.test.ts \
  tests/markdown-message.test.tsx \
  tests/thread-messages.test.ts
```

Expected:
- bootstrap and bridge tests pass
- markdown rendering still supports fenced code blocks and highlight output

- [ ] **Step 5: Commit the sidepanel split**

Run:

```bash
git add apps/browser-extension/src apps/browser-extension/tests
git commit -m $'refactor(sidepanel): 拆分面板状态与展示组件\n\nRefs: #66486125'
```

Expected: one commit that leaves `App.tsx` as a thin wrapper around the new `BrowserAcpPanel`.

---

### Task 4: Separate Daemon Transport, Application, and Storage Layers

**Files:**
- Create: `apps/acp-daemon/src/application/agentService.ts`
- Create: `apps/acp-daemon/src/application/sessionService.ts`
- Create: `apps/acp-daemon/src/config/daemonConfig.ts`
- Create: `apps/acp-daemon/src/http/daemonHttpServer.ts`
- Create: `apps/acp-daemon/src/storage/sessionStore.ts`
- Create: `apps/acp-daemon/src/ws/sessionWsGateway.ts`
- Modify: `apps/acp-daemon/src/index.ts`
- Modify: `apps/acp-daemon/src/server.ts`
- Modify: `apps/acp-daemon/src/session/sessionManager.ts`
- Modify: `apps/acp-daemon/tests/daemon-server.integration.test.ts`
- Modify: `apps/acp-daemon/tests/session-manager.test.ts`
- Modify: `apps/acp-daemon/tests/session-store.test.ts`

- [ ] **Step 1: Write a failing application-layer test that does not boot HTTP**

```ts
// apps/acp-daemon/tests/session-manager.test.ts
import { describe, expect, it, vi } from "vitest";
import { createSessionService } from "../src/application/sessionService";

describe("session service", () => {
  it("creates a session through the manager and persists via the store boundary", async () => {
    const manager = {
      createSession: vi.fn().mockResolvedValue({ id: "s1", agentId: "qoder-cli" }),
    };

    const service = createSessionService({ manager: manager as any });
    const result = await service.create({
      agent: { id: "qoder-cli" } as any,
      context: { title: "Example" } as any,
    });

    expect(manager.createSession).toHaveBeenCalled();
    expect(result.id).toBe("s1");
  });
});
```

- [ ] **Step 2: Run the daemon service test to watch it fail before the split**

Run: `pnpm --filter @browser-acp/acp-daemon test -- --run tests/session-manager.test.ts`

Expected: FAIL because `createSessionService` does not exist yet.

- [ ] **Step 3: Introduce explicit daemon config and application services**

```ts
// apps/acp-daemon/src/config/daemonConfig.ts
export const DEFAULT_DAEMON_RUNTIME_LIMIT = 3;
export const DAEMON_LOG_FILE_NAME = "daemon.log";
```

```ts
// apps/acp-daemon/src/application/sessionService.ts
import type { BrowserContextBundle, ConversationSummary, ResolvedAgent } from "@browser-acp/shared-types";
import type { SessionManager } from "../session/sessionManager.js";

export function createSessionService(deps: { manager: SessionManager }) {
  return {
    list(): Promise<ConversationSummary[]> {
      return deps.manager.listSessions();
    },
    create(input: { agent: ResolvedAgent; context: BrowserContextBundle }): Promise<ConversationSummary> {
      return deps.manager.createSession(input);
    },
    readTranscript(sessionId: string) {
      return deps.manager.readTranscript(sessionId);
    },
    sendPrompt(prompt: Parameters<SessionManager["sendPrompt"]>[0]) {
      return deps.manager.sendPrompt(prompt);
    },
    subscribe(sessionId: string, onEvent: Parameters<SessionManager["subscribe"]>[1]) {
      return deps.manager.subscribe(sessionId, onEvent);
    },
    cancel(sessionId: string) {
      return deps.manager.cancel(sessionId);
    },
  };
}
```

```ts
// apps/acp-daemon/src/http/daemonHttpServer.ts
export function createDaemonHttpServer(deps: {
  token: string;
  listAgents: () => Promise<ResolvedAgent[]>;
  sessions: ReturnType<typeof createSessionService>;
  logger: DebugLogger;
}) {
  // move HTTP request mapping here; keep request/response logic out of session services
}
```

- [ ] **Step 4: Move the store to `storage/` and keep `server.ts` as assembly only**

```ts
// apps/acp-daemon/src/server.ts
import { createSessionService } from "./application/sessionService.js";
import { createDaemonHttpServer } from "./http/daemonHttpServer.js";
import { createSessionWsGateway } from "./ws/sessionWsGateway.js";
import { SessionStore } from "./storage/sessionStore.js";

export function createDaemonApp(options: CreateDaemonAppOptions) {
  const store = new SessionStore(options.rootDir);
  const manager = new SessionManager(/* ... */);
  const sessions = createSessionService({ manager });
  const http = createDaemonHttpServer({ token: options.token, listAgents: options.listAgents, sessions, logger });
  const ws = createSessionWsGateway({ token: options.token, sessions, logger });
  return composeDaemonRuntime({ http, ws, manager });
}
```

- [ ] **Step 5: Run the daemon verification**

Run:

```bash
pnpm --filter @browser-acp/acp-daemon test
pnpm --filter @browser-acp/acp-daemon typecheck
```

Expected:
- service tests pass without binding HTTP
- integration tests still prove `/agents`, `/sessions`, and websocket replay behavior
- daemon typecheck stays green

- [ ] **Step 6: Commit the daemon layering change**

Run:

```bash
git add apps/acp-daemon/src apps/acp-daemon/tests
git commit -m $'refactor(daemon): 拆分传输层与应用服务\n\nRefs: #66486125'
```

Expected: one commit that leaves `server.ts` as composition and pushes transport logic out of business services.

---

### Task 5: Isolate Native Host Protocol, Bootstrap, and Platform Paths

**Files:**
- Create: `apps/native-host/src/bootstrap/daemonBootstrap.ts`
- Create: `apps/native-host/src/config/nativeHostConfig.ts`
- Create: `apps/native-host/src/platform/chromePaths.ts`
- Create: `apps/native-host/src/platform/macosShell.ts`
- Create: `apps/native-host/src/protocol/nativeMessagingProtocol.ts`
- Modify: `apps/native-host/src/index.ts`
- Modify: `apps/native-host/src/installManifest.ts`
- Modify: `apps/native-host/tests/daemon-bootstrap.test.ts`
- Modify: `apps/native-host/tests/install-manifest.test.ts`

- [ ] **Step 1: Write a failing path-resolution test that proves Chrome/macOS assumptions are isolated**

```ts
// apps/native-host/tests/install-manifest.test.ts
import { describe, expect, it } from "vitest";
import { resolveChromePaths } from "../src/platform/chromePaths";

describe("resolveChromePaths", () => {
  it("derives manifest and preference directories from one browser root", () => {
    const paths = resolveChromePaths("/Users/test/Library/Application Support/Google/Chrome");
    expect(paths.manifestDir).toContain("NativeMessagingHosts");
    expect(paths.preferenceRoots[0]).toContain("Default");
  });
});
```

- [ ] **Step 2: Run the native-host test and confirm it fails before the split**

Run: `pnpm --filter @browser-acp/native-host test -- --run tests/install-manifest.test.ts`

Expected: FAIL because the path resolver module does not exist yet.

- [ ] **Step 3: Extract config, protocol, and platform modules**

```ts
// apps/native-host/src/config/nativeHostConfig.ts
import { BROWSER_ACP_NATIVE_HOST_NAME, DAEMON_LOG_FILE_NAME, DAEMON_STATE_FILE_NAME } from "@browser-acp/config";

export const NATIVE_HOST_NAME = BROWSER_ACP_NATIVE_HOST_NAME;
export const NATIVE_HOST_DESCRIPTION = "Native messaging host for the Browser ACP side panel";
export const DEFAULT_APP_SUPPORT_DIR_NAME = "browser-acp";
export { DAEMON_LOG_FILE_NAME, DAEMON_STATE_FILE_NAME };
```

```ts
// apps/native-host/src/platform/chromePaths.ts
import { join } from "node:path";

export function resolveChromePaths(chromeRoot: string) {
  return {
    manifestDir: join(chromeRoot, "NativeMessagingHosts"),
    preferenceRoots: [
      join(chromeRoot, "Default", "Secure Preferences"),
      join(chromeRoot, "Default", "Preferences"),
    ],
  };
}
```

```ts
// apps/native-host/src/protocol/nativeMessagingProtocol.ts
export async function writeNativeMessagingResponse(payload: unknown) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}
```

- [ ] **Step 4: Move bootstrap logic under `bootstrap/` and keep `index.ts` as protocol + command dispatch**

```ts
// apps/native-host/src/index.ts
import { ensureDaemonRunning, getDaemonStatus } from "./bootstrap/daemonBootstrap.js";
import { writeNativeMessagingResponse } from "./protocol/nativeMessagingProtocol.js";

// parse request, dispatch command, write framed response
```

- [ ] **Step 5: Run the native-host verification**

Run:

```bash
pnpm --filter @browser-acp/native-host test
pnpm --filter @browser-acp/native-host typecheck
```

Expected:
- native-host tests pass with path resolution and bootstrap now testable in isolation
- `index.ts` becomes a thin native-messaging dispatcher

- [ ] **Step 6: Commit the native-host isolation change**

Run:

```bash
git add apps/native-host/src apps/native-host/tests
git commit -m $'refactor(native-host): 隔离平台路径与协议处理\n\nRefs: #66486125'
```

Expected: one commit that isolates Chrome/macOS assumptions from generic daemon bootstrap flow.

---

### Task 6: Remove Leftover Drift and Run Final Verification

**Files:**
- Modify: `.gitignore`
- Delete: `apps/browser-extension/src/sidepanel/index.html`
- Modify: `apps/browser-extension/sidepanel.html`

- [ ] **Step 1: Write the smallest failing regression check for the sidepanel entry**

```ts
// apps/browser-extension/tests/sidepanel-entry.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("sidepanel entry", () => {
  it("keeps one authoritative HTML entry", () => {
    const html = readFileSync("apps/browser-extension/sidepanel.html", "utf8");
    expect(html).toContain("sidepanel/main.tsx");
  });
});
```

- [ ] **Step 2: Run the targeted regression test and verify it fails if the authoritative entry is wrong**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/sidepanel-entry.test.ts`

Expected: FAIL if the current entry still points at the old duplicated path.

- [ ] **Step 3: Remove the duplicate HTML and keep only the top-level sidepanel entry**

```html
<!-- apps/browser-extension/sidepanel.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Browser ACP</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/sidepanel/main.tsx"></script>
  </body>
</html>
```

Run:

```bash
rm apps/browser-extension/src/sidepanel/index.html
printf '\nbrowser-acp-extension.zip\n' >> .gitignore
```

Expected:
- only one sidepanel HTML entry remains
- release zip stays out of future architecture commits

- [ ] **Step 4: Run full repository verification**

Run:

```bash
pnpm -r test
pnpm -r typecheck
pnpm -r build
rg -n "com\\.browser_acp\\.host|http://127\\.0\\.0\\.1|browser-acp-debug-logs|browser-acp-pending-selection-action|Library/Application Support/Google/Chrome|NativeMessagingHosts" apps packages --glob '!**/dist/**'
```

Expected:
- all package tests pass
- all packages typecheck
- build succeeds
- the final `rg` output only points at config or platform-edge modules, not business-flow files

- [ ] **Step 5: Commit the final cleanup**

Run:

```bash
git add .gitignore apps/browser-extension/sidepanel.html apps/browser-extension/src/sidepanel
git commit -m $'chore(architecture): 清理重复入口与产物忽略规则\n\nRefs: #66486125'
```

Expected: final cleanup lands separately from the architecture refactors above.

---

## Self-Review

### Spec Coverage

- Centralized constants: covered in Task 1 via `packages/config`.
- Extension modular split: covered in Task 2 and Task 3.
- Daemon layering: covered in Task 4.
- Native-host platform isolation: covered in Task 5.
- Hardcoding cleanup and duplicate drift: covered in Task 6.

### Placeholder Scan

- No placeholder markers remain in the plan body.
- Every code-changing task includes concrete file targets and concrete code blocks.
- Every verification step includes exact commands and expected outcomes.

### Type Consistency

- Shared config imports use `@browser-acp/config` consistently.
- Extension refactor uses `PendingSelectionAction`, `SelectionActionType`, and `BrowserAcpBridge` consistently across tasks.
- Daemon tasks refer to `createSessionService` and `SessionStore` using the same names throughout.
- Native-host tasks consistently use `resolveChromePaths`, `writeNativeMessagingResponse`, and `NATIVE_HOST_NAME`.

Plan complete and saved to `docs/superpowers/plans/2026-04-10-architecture-hardening.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Because you already told me to keep moving without pausing, use **Inline Execution** for this run.
