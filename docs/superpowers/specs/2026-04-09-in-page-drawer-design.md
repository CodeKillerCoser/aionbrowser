# Browser ACP In-Page Drawer Design

## Goal

Replace the Chrome native `sidePanel` container with an in-page right split view so Browser ACP controls its own open/close motion, supports Monica-style side-by-side browsing, and still reuses the existing agent/session/prompt pipeline.

## Problem

The current extension hosts the chat UI inside Chrome's native side panel. That creates two product issues:

1. The panel close animation is controlled by Chrome, so we cannot tune its duration or easing.
2. The interaction style does not match the lighter, in-page assistant experience the user wants.

The extension already has working pieces we should preserve:

- content-script quick actions for selected text
- background-managed daemon/session/bootstrap requests
- prompt sending through the daemon websocket
- session transcript UI and Markdown rendering

## Recommended Approach

Use an in-page split-view shell rendered from the content script inside a Shadow DOM host, while reusing the existing panel logic and background bridge.

This approach keeps the protocol layer stable and changes only the UI container:

- The browser action no longer opens `chrome.sidePanel`.
- The content script owns a persistent split-view host on each page.
- The split view mounts the existing React chat panel inside Shadow DOM.
- Quick actions continue to use background-managed pending selection actions for reliability, then the drawer claims and dispatches them.

## Non-Goals

- Rebuilding the session or daemon protocol
- Rewriting the chat panel from scratch
- Adding new assistant capabilities beyond the current quick actions and prompt flow

## Architecture

### 1. Shared panel module

Move the chat UI out of `src/sidepanel/*` into a reusable panel module. The reusable module will contain:

- `BrowserAcpPanel`
- markdown rendering
- thread message shaping
- chrome bridge interface

This panel remains responsible for:

- bootstrap and diagnostics loading
- listing agents and sessions
- connecting to websocket sessions
- creating sessions and sending prompts
- rendering transcript/debug/composer UI

### 2. In-page split-view host

The content script will mount a single Shadow DOM host into the page. Inside that host, a React split-view component will render:

- a right-side fixed panel shell
- a drag handle for width resizing
- a header with our own close button
- the shared `BrowserAcpPanel`

The page layout is also updated with a split-view state on `documentElement`, so the original webpage shrinks into the remaining left viewport instead of being covered by an overlay.

The split view stays closed by default and opens when:

- the user clicks the extension action
- the user clicks one of the selection quick actions

The split view closes when:

- the user clicks the close button
- the user presses `Escape`

### 3. Background as coordinator

Background remains the orchestration layer for cross-context coordination:

- action click -> send `browser-acp/open-drawer` to the active tab
- selection quick action -> persist pending action, then notify the tab to open the drawer
- diagnostics/context requests remain unchanged

The pending selection action flow stays in background for resilience across service-worker restarts.

### 4. Messaging changes

Add a runtime message for opening the in-page split view:

- `browser-acp/open-drawer`

Keep the existing messages:

- `browser-acp/trigger-selection-action`
- `browser-acp/claim-pending-selection-action`
- `browser-acp/selection-action-ready`
- `browser-acp/context-changed`

The content-side shell listens for open/selection-ready messages, opens itself, then lets the embedded panel claim any pending action.

## UI and Motion

The split view should feel light and quick, not heavy or system-like.

- Default width: `420px`
- Resizable width: drag handle on the panel's left edge
- Width bounds: constrained to keep both the left page and right panel usable
- Open motion: page and panel reflow together using `220ms`, `cubic-bezier(0.22, 1, 0.36, 1)`
- Close motion: page returns to full width while panel exits using a shorter `150ms` transition
- Panel shell: subtle left border, airy padding, no backdrop so the page remains directly operable

The floating text-selection menu remains lightweight and should open the split view immediately after an action click.

## Manifest Changes

Once the drawer path is complete:

- remove `sidePanel` permission
- remove `side_panel.default_path`

The browser action continues to exist, but now opens the in-page drawer through tab messaging.

## Testing Strategy

Only add targeted tests needed to lock the behavior:

1. Background test: browser action sends `browser-acp/open-drawer` to the active tab instead of calling `chrome.sidePanel.open`.
2. Background test: selection quick action queues pending action and notifies the tab to open the drawer.
3. Content/split-view test: runtime open message opens the split view host and applies page layout state.
4. Content/split-view test: selection quick action click opens the split view and results in prompt dispatch through the embedded panel flow.
5. Content/split-view test: dragging the resize handle updates and persists width.
6. Manifest test: no `side_panel` config remains after migration.

## Risks and Mitigations

### CSS leakage

Risk: page styles interfere with our embedded UI.

Mitigation: render the drawer inside Shadow DOM and scope panel styles to the drawer root.

### Duplicate drawer instances

Risk: repeated content-script injection could create multiple hosts/listeners.

Mitigation: keep a single global cleanup/host guard, similar to the current selection-menu installation guard.

### Session/send regressions

Risk: moving the container breaks prompt dispatch or websocket timing.

Mitigation: preserve `BrowserAcpPanel` behavior and test the open-and-send path end to end through mocked bridges.
