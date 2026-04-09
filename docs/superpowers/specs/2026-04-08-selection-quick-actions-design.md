# Selection Quick Actions Design

## Goal

Replace live selection synchronization with a lightweight contextual popup menu. After the user selects text on a page, the extension shows quick actions next to the selection. Clicking an action opens the side panel and immediately sends a prebuilt prompt that includes the selected text.

## User Experience

- The extension no longer tries to keep `Selected Text` in the side panel updated in real time while the user is selecting text.
- On `mouseup`, if the page has a non-empty text selection, a small popup appears near the selection.
- The popup offers three actions:
  - `解释`
  - `搜索`
  - `提供样例`
- Clicking an action closes the popup, opens the Browser ACP side panel, and sends the generated prompt automatically.
- The send target prefers the currently selected session. If no session is selected, the panel creates a new one.

## Architecture

This feature uses a `content -> background -> sidepanel` pipeline so the existing sidepanel send flow remains the source of truth.

- `content.ts`
  - Detects mouse-based text selections.
  - Renders and manages the popup UI.
  - Sends the chosen quick action to background with the selected text.
  - Stops listening for live selection synchronization events.
- `background.ts`
  - Receives quick action requests from content scripts.
  - Opens the side panel in the current window.
  - Stores a single pending quick action payload.
  - Notifies the side panel that a quick action is ready.
- `sidepanel/App.tsx` and `sidepanel/bridge.ts`
  - Claim the pending quick action payload from background.
  - Reuse `handleSendPrompt`.
  - Prefer the current session; create one only when needed.

## Prompt Templates

- `解释`
  - `请解释下面这段内容，结合当前页面上下文说明重点和含义：\n\n{{selection}}`
- `搜索`
  - `请基于下面这段内容，提炼搜索关键词、核心问题，并给出后续搜索方向：\n\n{{selection}}`
- `提供样例`
  - `请基于下面这段内容，给出具体样例或示例代码，并说明如何使用：\n\n{{selection}}`

Background will materialize the final prompt text before the side panel consumes it.

## Popup Behavior

- The popup appears only after `mouseup`.
- It anchors near the mouse release position, with viewport clamping to avoid rendering off-screen.
- It closes when:
  - the user clicks outside the popup,
  - the user scrolls,
  - the user presses `Escape`,
  - the selection becomes empty,
  - the user triggers one of the actions.
- The popup should not rely on the side panel being open.

## Data Contracts

### New background request from content script

- `browser-acp/trigger-selection-action`
  - payload:
    - `action`: `"explain" | "search" | "examples"`
    - `selectionText`: `string`

### New background request from side panel

- `browser-acp/claim-pending-selection-action`
  - returns:
    - `null`, or
    - `{ id, action, selectionText, promptText, createdAt }`
  - claim semantics are destructive so the same action is processed once.

### New runtime notification

- `browser-acp/selection-action-ready`
  - used as a wake-up signal for the side panel
  - the side panel claims the payload after receiving the signal

## State Model

- Background keeps one in-memory pending quick action.
- A newer quick action replaces an older unclaimed one.
- The side panel claims the pending action on:
  - initial bootstrap,
  - runtime wake-up notifications.

## Testing Strategy

- `content.test.ts`
  - popup appears after a mouse selection
  - clicking a popup action sends the quick action request
  - popup closes on outside click / action click
  - no selection-change-driven sync behavior remains
- `background.test.ts`
  - quick action requests open the side panel and store a pending payload
  - claim requests return and clear the pending payload
  - runtime wake-up notification is emitted
- `app.test.tsx`
  - side panel claims a pending quick action during bootstrap and auto-sends it
  - quick action uses current session when one exists
  - quick action creates a new session only when no current session exists

## Risks

- Popup positioning on editor surfaces may be imperfect if the native selection rectangle is unavailable. Anchoring to mouse coordinates keeps behavior predictable.
- Runtime messaging can race with side panel startup, so background storage plus claim semantics is required.

## Out of Scope

- Browser right-click context menu integration
- Keyboard-only selection quick actions
- Persisting quick action history
- Supporting more than one pending quick action at a time
