# Browser ACP

A Chromium side-panel extension and local ACP bridge that turns local coding CLIs into an AI reading companion for the current web page.

## Workspace

- `apps/browser-extension`: Chromium extension with side panel, background worker, and content script
- `apps/acp-daemon`: Local ACP daemon that discovers agents, starts ACP sessions, and exposes HTTP/WS endpoints
- `apps/native-host`: Native messaging host that bootstraps the daemon on demand
- `packages/shared-types`: Shared protocol and domain types

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### Development

```bash
pnpm dev:daemon
pnpm dev:native-host
pnpm dev:extension
```

## Native Host Setup

The extension expects the native messaging host name `com.browser_acp.host`.

Recommended on macOS:

```bash
pnpm --filter @browser-acp/native-host build
pnpm install:native-host
```

The installer will:

- build a small executable launcher under `~/Library/Application Support/browser-acp/bin/com.browser_acp.host`
- detect loaded `Browser ACP` extension IDs from Chrome profiles
- write the native messaging manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browser_acp.host.json`

Manual fallback: use the template at [apps/native-host/native-host-manifest.template.json](/Users/wangxin/Developer/Work/browser_acp/apps/native-host/native-host-manifest.template.json) and replace:

- `__HOST_PATH__` with the absolute path to the built native host entrypoint
- `__EXTENSION_ID__` with the installed Chromium extension ID

On macOS, the installed manifest should live under:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browser_acp.host.json
```

## Daemon API

- `GET /health`
- `GET /agents`
- `GET /sessions`
- `POST /sessions`
- `WS /sessions/:id`

All daemon HTTP requests require `Authorization: Bearer <token>`.
