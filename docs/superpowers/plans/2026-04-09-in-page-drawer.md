# In-Page Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chrome native side panel usage with an in-page right split view while preserving the existing session, markdown, and prompt flows.

**Architecture:** Keep the chat UI reusable, mount it from the content script inside a Shadow DOM split-view host, and replace `chrome.sidePanel` opens with background-to-tab open messages. The host coordinates page reflow, a resizable right panel, and pending selection actions from background.

**Tech Stack:** Chrome extension MV3, React, TypeScript, Vitest, React Testing Library, CRXJS, Shadow DOM

---

### Task 1: Lock the new open-drawer contract in tests

**Files:**
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/background.test.ts`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/content.test.ts`

- [ ] **Step 1: Write the failing background tests**

Add tests asserting:

- browser action click sends a tab message with `{ type: "browser-acp/open-drawer" }`
- selection quick action notifies the tab to open the drawer instead of calling `chrome.sidePanel.open`

- [ ] **Step 2: Run the targeted background tests to verify they fail**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/background.test.ts`
Expected: FAIL because background still calls `chrome.sidePanel.open`.

- [ ] **Step 3: Write the failing content test**

Add a test asserting a received runtime open-drawer message makes the in-page drawer visible.

- [ ] **Step 4: Run the targeted content test to verify it fails**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/content.test.ts`
Expected: FAIL because content script has no drawer host yet.

### Task 2: Add the drawer messaging primitives

**Files:**
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/messages.ts`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/background.ts`

- [ ] **Step 1: Implement the new runtime message type**

Add `browser-acp/open-drawer` to `BackgroundRuntimeMessage`.

- [ ] **Step 2: Replace side panel opening with tab notifications**

Update browser-action and selection-action flows to notify the active/current tab to open the drawer.

- [ ] **Step 3: Re-run the background tests**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/background.test.ts`
Expected: PASS

### Task 3: Extract the reusable panel module

**Files:**
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/BrowserAcpPanel.tsx`
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/createChromeBridge.ts`
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/MarkdownMessage.tsx`
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/threadMessages.ts`
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/styles.css`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/sidepanel/App.tsx`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/sidepanel/bridge.ts`

- [ ] **Step 1: Move the existing panel logic into shared files**

Lift the current sidepanel implementation into the reusable `src/panel/*` module with minimal behavior changes.

- [ ] **Step 2: Keep sidepanel entry compiling as a thin wrapper**

Make `src/sidepanel/App.tsx` re-export or wrap the shared panel so existing tests continue to work during migration.

- [ ] **Step 3: Run panel-related tests**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/app.test.tsx tests/bridge.test.ts tests/markdown-message.test.tsx tests/thread-messages.test.ts`
Expected: PASS

### Task 4: Build the Shadow DOM drawer host

**Files:**
- Create: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/contentDrawer.tsx`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/content.ts`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/content.test.ts`

- [ ] **Step 1: Implement a single in-page drawer host**

Mount one Shadow DOM host from the content script with:

- backdrop
- right drawer shell
- close button
- shared `BrowserAcpPanel`

- [ ] **Step 2: Wire open/close behaviors**

Handle:

- runtime `browser-acp/open-drawer`
- runtime `browser-acp/selection-action-ready`
- backdrop click
- `Escape`

- [ ] **Step 3: Re-run the content tests**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/content.test.ts`
Expected: PASS

### Task 5: Tune drawer motion and shell styling

**Files:**
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/contentDrawer.tsx`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/src/panel/styles.css`

- [ ] **Step 1: Apply the drawer container styles**

Set:

- panel width around `460px`
- open timing `220ms cubic-bezier(0.22, 1, 0.36, 1)`
- close timing `150ms cubic-bezier(0.22, 1, 0.36, 1)`

- [ ] **Step 2: Make the panel layout work inside the drawer host**

Update root selectors so the panel styles are container-based instead of relying on page `body`/`#root`.

- [ ] **Step 3: Verify the UI tests still pass**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/app.test.tsx tests/content.test.ts`
Expected: PASS

### Task 6: Remove side panel manifest usage

**Files:**
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/manifest.config.ts`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/manifest.test.ts`

- [ ] **Step 1: Write the failing manifest test**

Change the manifest test to assert `side_panel` config and `sidePanel` permission are absent.

- [ ] **Step 2: Run the manifest test to verify it fails**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/manifest.test.ts`
Expected: FAIL because the manifest still declares native side panel support.

- [ ] **Step 3: Remove native side panel config**

Delete the permission and manifest section once drawer behavior is wired.

- [ ] **Step 4: Re-run the manifest test**

Run: `pnpm --filter @browser-acp/browser-extension test -- --run tests/manifest.test.ts`
Expected: PASS

### Task 7: Run focused regression verification

**Files:**
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/app.test.tsx`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/background.test.ts`
- Modify: `/Users/wangxin/Developer/Work/browser_acp/apps/browser-extension/tests/content.test.ts`

- [ ] **Step 1: Add or update a regression test for selection quick action dispatch**

Ensure clicking `解释 / 搜索 / 提供样例` still leads to prompt dispatch through the embedded panel.

- [ ] **Step 2: Run the full browser-extension suite**

Run: `pnpm --filter @browser-acp/browser-extension test`
Expected: PASS

- [ ] **Step 3: Run static verification**

Run: `pnpm --filter @browser-acp/browser-extension typecheck`
Expected: PASS

- [ ] **Step 4: Run production build**

Run: `pnpm --filter @browser-acp/browser-extension build`
Expected: PASS
