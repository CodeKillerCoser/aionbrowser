# Browser ACP Architecture Hardening Design

## Goal

Restructure Browser ACP into a maintainable multi-package system with explicit module boundaries, centralized configuration, and minimal hardcoding while preserving the current product behavior:

- Chrome native `sidePanel` remains the extension container
- current daemon, native-host, session, and quick-action flows continue to work
- no user-visible feature regressions are introduced as part of the architecture work

This design treats the current codebase as a valid prototype baseline and upgrades it into an evolvable architecture.

## Why This Refactor Is Necessary

The current repository already has the correct top-level package split:

- `apps/browser-extension`
- `apps/acp-daemon`
- `apps/native-host`
- `packages/shared-types`

However, each package still contains architectural hotspots and repeated constants:

1. Key workflows are concentrated in a few large files, especially the extension background worker and the side panel application shell.
2. Browser/platform details are mixed into core logic.
3. Configuration is encoded inline as string constants, filesystem paths, storage keys, and host identifiers.
4. Shared package boundaries are blurred because local development resolves directly from source while published surfaces point at build output.

These problems make the system fragile in exactly the places we need long-term stability:

- UI shell changes
- cross-context browser messaging
- daemon bootstrapping and process control
- platform expansion
- protocol evolution

## Success Criteria

The refactor is complete when the following conditions hold:

1. No business workflow file contains scattered hardcoded host names, storage keys, URLs, filesystem roots, or browser-specific paths.
2. Each app package has a thin entrypoint and explicit internal module layering.
3. Shared packages expose one authoritative source of truth for types and runtime-safe constants.
4. Platform-specific behavior is isolated behind adapter or environment modules.
5. Existing tests still pass, and new tests focus on boundaries rather than implementation trivia.
6. The repository layout makes the next feature change predictable: where to put code, where to put config, and what not to couple.

## Non-Goals

This refactor does not include:

- changing the end-user product model
- replacing Chrome native `sidePanel`
- redesigning ACP protocol semantics
- adding new assistant capabilities
- adding cross-browser or cross-platform support immediately

The work only creates the seams that make those future changes safe.

## Recommended Approach

Use a staged internal architecture refactor with strict compatibility:

1. Introduce centralized configuration and environment modules first.
2. Split large files into domain modules while preserving external message and API contracts.
3. Move platform-specific concerns behind dedicated adapters.
4. Clean shared package boundaries so build-time and runtime surfaces match.

This approach is preferred over a full rewrite because it preserves current working behavior and keeps regression scope measurable.

## Alternatives Considered

### Option 1: Incremental hardening with compatibility preservation

Refactor the existing packages in place, keep current protocol shapes, and move code behind clearer boundaries step by step.

Pros:

- lowest delivery risk
- easiest to verify continuously
- does not force product changes while architecture stabilizes

Cons:

- some transitional indirection remains during the migration

This is the recommended option.

### Option 2: Full architecture reset

Redesign every package and protocol together, then migrate all consumers in one pass.

Pros:

- theoretically cleanest result

Cons:

- very high regression risk
- forces simultaneous UI, protocol, and infrastructure churn
- difficult to validate safely

### Option 3: Superficial file splitting only

Split large files without introducing configuration or adapter layers.

Pros:

- fast to start

Cons:

- hardcoding remains
- dependency direction remains unclear
- later changes still require cross-cutting edits

This option is explicitly rejected.

## Architecture Principles

### 1. Thin entrypoints

Every package entry file should only do bootstrap and composition.

Entrypoints should not contain:

- business rules
- path construction
- protocol formatting
- process lifecycle policy
- UI orchestration logic

### 2. Inward-facing dependencies

Domain/application modules may depend on contracts and adapters, but platform-specific code must not leak inward.

Examples:

- extension domain code should not call `chrome.*` directly
- daemon services should not know about raw HTTP request objects
- native-host orchestration should not hardcode Chrome/macOS paths inside generic process-control logic

### 3. Centralized config, not scattered constants

All repeatable runtime constants must come from owned config modules.

This includes:

- native host name
- daemon base host
- storage keys
- log file names
- default root directories
- browser-specific manifest paths
- sidepanel entry path
- selection action prompt templates

### 4. One package, one truth

Shared packages must not expose divergent dev/runtime surfaces.

If a package exports `dist` to consumers, repository-local development must not silently rely on a different shape from `src` that can drift.

### 5. Domain-first tests

Tests should validate:

- message routing contracts
- configuration resolution
- adapter behavior
- session orchestration boundaries

Tests should avoid overfitting to internal implementation or transient file layout.

## Target Repository Structure

### `packages/shared-types`

Responsibility:

- shared protocol types only

Rules:

- keep only source TypeScript in `src/`
- generated artifacts belong in `dist/` only
- do not commit mirrored generated `.js/.d.ts` files inside `src/`

Future-compatible extension:

- if runtime-safe shared constants are needed, add a separate shared config package instead of mixing type-only exports with environment-specific values

### `packages/config`

New package to introduce in this refactor.

Responsibility:

- cross-package runtime-safe constants and config schemas

Initial contents:

- extension constants
- daemon endpoint defaults
- native host identifiers
- log/storage key names
- default directory names
- prompt template identifiers

This package must remain platform-neutral at the top level. Platform-specific path derivation belongs in app-local platform modules, not in shared config.

### `apps/browser-extension`

Target internal layout:

- `src/entry/`
- `src/platform/`
- `src/context/`
- `src/session/`
- `src/debug/`
- `src/ui/sidepanel/`
- `src/contracts/`

### Extension layering

#### `entry/`

Contains:

- background bootstrap entry
- content-script entry
- sidepanel entry

Only composes modules.

#### `platform/`

Contains Chrome-specific adapters:

- tabs adapter
- runtime messaging adapter
- sidepanel adapter
- native messaging adapter
- storage adapter
- scripting adapter

This is the only place where `chrome.*` should be touched directly.

#### `context/`

Contains page-context logic:

- selection resolution
- frame merging
- page capture helpers
- context snapshot policies

#### `session/`

Contains extension-side orchestration for:

- daemon bootstrap client
- HTTP requests to daemon
- session creation
- prompt dispatch preparation
- pending selection action coordination

#### `debug/`

Contains:

- background log store
- log sanitization
- debug-state assembly

#### `ui/sidepanel/`

Contains:

- `BrowserAcpPanel`
- focused React hooks for bootstrap, sessions, and diagnostics
- purely presentational components
- markdown rendering
- thread shaping utilities

### Required internal split

The current background file should be decomposed into:

- message router
- active-context service
- pending-selection-action service
- daemon client
- debug-log service
- platform bridge

The current sidepanel file should be decomposed into:

- bootstrap hook
- session socket hook
- selection action hook
- debug hook
- composer/transcript/sidebar components

### `apps/acp-daemon`

Target internal layout:

- `src/entry/`
- `src/http/`
- `src/ws/`
- `src/application/`
- `src/runtime/`
- `src/catalog/`
- `src/storage/`
- `src/debug/`
- `src/config/`

### Daemon layering

#### `entry/`

CLI argument parsing and app composition only.

#### `http/` and `ws/`

Transport adapters only:

- request/response mapping
- auth extraction
- websocket upgrade wiring

They should call application services and return mapped results.

#### `application/`

Contains use cases:

- list agents
- create session
- restore session
- send prompt
- read transcript

`SessionManager` should be split so persistence, runtime lifecycle, and event fan-out are explicit collaborators instead of one large coordinator.

#### `runtime/`

Contains ACP runtime process/session integration only.

#### `storage/`

Contains session persistence and transcript persistence only.

#### `config/`

Contains daemon-local defaults:

- runtime pool size
- state file names
- log file names

### `apps/native-host`

Target internal layout:

- `src/entry/`
- `src/protocol/`
- `src/bootstrap/`
- `src/platform/`
- `src/debug/`
- `src/config/`

### Native-host layering

#### `protocol/`

Native messaging stdin/stdout framing only.

#### `bootstrap/`

Generic daemon process lifecycle:

- ensure running
- health check
- port/token generation
- readiness waiting

This layer should not hardcode Chrome or macOS.

#### `platform/`

Browser and OS integration:

- Chrome preferences scanning
- NativeMessagingHosts installation path resolution
- launcher script generation
- platform-specific commands like opening logs

This layer should make current macOS/Chrome assumptions explicit and isolated.

## Hardcoding Elimination Plan

### Centralize these constants immediately

Move the following out of business-flow files:

- `com.browser_acp.host`
- `http://127.0.0.1`
- `browser-acp-debug-logs`
- `browser-acp-pending-selection-action`
- daemon/session log file names
- sidepanel manifest path
- selection-action prompt strings

### Introduce environment resolvers

Instead of inline path assembly, create explicit resolver functions such as:

- `resolveBrowserProfileRoot()`
- `resolveNativeMessagingManifestDir()`
- `resolveBrowserAcpRootDir()`
- `resolveDaemonStatePath(rootDir)`
- `resolveDaemonLogPath(rootDir)`

These functions make assumptions inspectable and testable.

### Keep platform assumptions at the edge

Current macOS/Chrome defaults are acceptable as default adapters, but they must live behind named modules so future support for additional environments is additive rather than invasive.

## Migration Plan

### Phase 1: Config and contract cleanup

- add `packages/config`
- move repeated constants into config modules
- remove generated artifacts from `packages/shared-types/src`
- align local development and build outputs around a single source of truth

Deliverable:

- no repeated cross-package constants in workflow files

### Phase 2: Extension architecture split

- create extension platform adapters
- split background into services + router
- split sidepanel into hooks + components
- keep runtime message contracts unchanged

Deliverable:

- extension entrypoints become thin

### Phase 3: Daemon application layering

- separate transport from use-case services
- split session lifecycle from persistence and event dispatch
- isolate daemon config defaults

Deliverable:

- daemon services become composable and testable by layer

### Phase 4: Native-host platform isolation

- separate native messaging protocol from bootstrap logic
- isolate Chrome/macOS install rules into platform modules
- make launcher and path resolution testable

Deliverable:

- core bootstrap flow is platform-neutral

## Testing Strategy

Add tests only where they protect boundaries:

1. config resolution tests for path/identifier/default handling
2. extension platform-adapter tests for runtime/tabs/sidepanel wiring
3. background router tests that verify message-to-service delegation
4. sidepanel hook tests for bootstrap and selection-action flow
5. daemon application tests that do not require HTTP transport
6. native-host platform tests for manifest/path resolution

Existing behavior tests should remain green throughout.

## Risks and Mitigations

### Risk: refactor churn breaks working flows

Mitigation:

- preserve external contracts during all phases
- land changes package by package
- keep tests focused on stable behavior

### Risk: config package becomes a dumping ground

Mitigation:

- only store shared runtime-safe constants and config schema there
- keep platform path logic in app-local platform modules

### Risk: architectural split becomes cosmetic

Mitigation:

- enforce dependency direction during implementation
- move APIs, not just files
- remove direct platform calls from domain modules

### Risk: generated artifacts drift again

Mitigation:

- keep generated files out of source directories
- make package export targets and workspace resolution agree

## Expected Outcome

After this refactor, Browser ACP will still behave like the same product, but the codebase will operate like a real system instead of a prototype cluster:

- clearer ownership per package
- smaller and more replaceable modules
- explicit platform boundaries
- centralized configuration
- reduced hardcoding
- safer future work on UI shell, protocol, platform support, and runtime behavior
