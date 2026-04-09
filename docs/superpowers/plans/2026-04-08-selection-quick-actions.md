# Selection Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live selection syncing with a contextual popup menu that opens the side panel and auto-sends a prebuilt prompt for the selected text.

**Architecture:** Content scripts own popup rendering and quick action intent capture. Background owns pending quick action state and side panel activation. The side panel claims pending quick actions and reuses the existing prompt send pipeline.

**Tech Stack:** Chrome Extension Manifest V3, React, TypeScript, Vitest, CRXJS/Vite

---

### Task 1: Define the quick action message contracts

**Files:**
- Modify: `apps/browser-extension/src/messages.ts`
- Test: `apps/browser-extension/tests/bridge.test.ts`

- [ ] **Step 1: Add message and payload types**
- [ ] **Step 2: Add bridge coverage for claiming pending quick actions**
- [ ] **Step 3: Run the targeted bridge tests**

### Task 2: Replace live selection sync with popup behavior in content script

**Files:**
- Modify: `apps/browser-extension/src/content.ts`
- Test: `apps/browser-extension/tests/content.test.ts`

- [ ] **Step 1: Write failing tests for popup visibility and action dispatch**
- [ ] **Step 2: Remove selection-sync listeners from content script**
- [ ] **Step 3: Implement popup rendering, closing rules, and action messaging**
- [ ] **Step 4: Run content tests**

### Task 3: Add background quick action queueing and claim semantics

**Files:**
- Modify: `apps/browser-extension/src/background.ts`
- Modify: `apps/browser-extension/src/messages.ts`
- Test: `apps/browser-extension/tests/background.test.ts`

- [ ] **Step 1: Write failing tests for trigger, open-panel, notify, and claim flows**
- [ ] **Step 2: Implement pending quick action storage and prompt template generation**
- [ ] **Step 3: Implement claim request handling and runtime notification**
- [ ] **Step 4: Run background tests**

### Task 4: Teach the side panel to consume pending quick actions

**Files:**
- Modify: `apps/browser-extension/src/sidepanel/bridge.ts`
- Modify: `apps/browser-extension/src/sidepanel/App.tsx`
- Test: `apps/browser-extension/tests/app.test.tsx`

- [ ] **Step 1: Write failing tests for bootstrap claim and runtime-triggered auto-send**
- [ ] **Step 2: Add bridge methods for claim and quick action subscription**
- [ ] **Step 3: Reuse `handleSendPrompt` to auto-send the claimed prompt**
- [ ] **Step 4: Run app tests**

### Task 5: Verify the complete feature set

**Files:**
- Test: `apps/browser-extension/tests/background.test.ts`
- Test: `apps/browser-extension/tests/page-context.test.ts`
- Test: `apps/browser-extension/tests/page-capture.test.ts`
- Test: `apps/browser-extension/tests/manifest.test.ts`
- Test: `apps/browser-extension/tests/content.test.ts`
- Test: `apps/browser-extension/tests/context-state.test.ts`
- Test: `apps/browser-extension/tests/app.test.tsx`

- [ ] **Step 1: Run the full browser-extension test subset**
- [ ] **Step 2: Run `typecheck`**
- [ ] **Step 3: Run `build`**
- [ ] **Step 4: Summarize behavior changes and remaining risks**
