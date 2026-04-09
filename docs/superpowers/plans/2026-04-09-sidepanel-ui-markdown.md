# Sidepanel UI + Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidepanel feel simpler and lighter while rendering transcript bubbles with Markdown and syntax-highlighted code blocks.

**Architecture:** Add a small dedicated Markdown renderer component for transcript text parts, keep the existing event-to-thread-message pipeline unchanged, and restyle the sidepanel shell with a lighter visual system. The UI refresh stays inside the current layout and state model so behavior changes remain small and testable.

**Tech Stack:** React 19, TypeScript, `react-markdown`, `remark-gfm`, `rehype-highlight`, CSS

---

### Task 1: Add Markdown renderer coverage

**Files:**
- Create: `apps/browser-extension/tests/markdown-message.test.tsx`

- [ ] **Step 1: Write the failing renderer test**

- [ ] **Step 2: Run the test to verify Markdown rendering support is missing**

### Task 2: Implement transcript Markdown rendering

**Files:**
- Create: `apps/browser-extension/src/sidepanel/MarkdownMessage.tsx`
- Modify: `apps/browser-extension/src/sidepanel/App.tsx`
- Modify: `apps/browser-extension/package.json`

- [ ] **Step 1: Add the Markdown rendering dependencies**

- [ ] **Step 2: Implement the dedicated renderer component**

- [ ] **Step 3: Replace plain paragraph rendering in transcript bubbles**

- [ ] **Step 4: Run focused tests to verify the renderer works**

### Task 3: Refresh the sidepanel visual system

**Files:**
- Modify: `apps/browser-extension/src/sidepanel/styles.css`

- [ ] **Step 1: Lighten shell, sidebar, transcript, and bubble styling**

- [ ] **Step 2: Add Markdown typography and code block presentation**

- [ ] **Step 3: Keep empty states, controls, and composer readable at narrow widths**

### Task 4: Verify the integrated result

**Files:**
- Test: `apps/browser-extension/tests/markdown-message.test.tsx`
- Test: `apps/browser-extension/tests/app.test.tsx`

- [ ] **Step 1: Run targeted tests**

- [ ] **Step 2: Run `typecheck`**

- [ ] **Step 3: Run `build`**
