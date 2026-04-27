# Multi-Host Reuse Implementation Status

Date: 2026-04-27

## Status

The primary browser-environment separation target from `docs/superpowers/specs/2026-04-20-multi-host-reuse-architecture-design.md` is implemented.

## Current Boundaries

- `packages/host-api` defines the host-facing console contract.
- `packages/client-core` owns platform-neutral sidepanel state helpers, prompt preparation, optimistic prompt handling, session event reduction, and socket status helpers.
- `packages/ui-react` owns reusable React presentation components and UI-only helpers.
- `packages/runtime-core` owns platform-neutral runtime catalog, registry, prompt, runtime, and session manager contracts.
- `packages/runtime-node` owns Node-specific runtime process launch, browser context file writing, and runtime session wiring.
- `apps/browser-extension` now acts as the Chrome extension host shell: manifest, sidepanel entry, Chrome bridge, browser context capture, native messaging, and browser-specific panel hooks.
- `apps/acp-daemon` now composes runtime packages instead of owning the extracted runtime model directly.

## Browser Context Handling

Dynamic browser context is no longer embedded as a large user prompt payload. The runtime writes it into the workspace temporary area under `.browser-acp/tmp/browser-contexts/`, then passes a compact file reference into the model-facing prompt.

## Remaining Work

These are optional hardening tasks rather than blockers for the multi-host extraction:

- Split the large change set into reviewable commits.
- Add another host proof-of-concept that implements `host-api` without Chrome APIs.
- Continue moving browser-extension-only hooks into a reusable client React package if a second host needs them.
- Consider bundle splitting for the existing sidepanel chunk size warning.
