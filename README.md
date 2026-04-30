# Browser ACP

Browser ACP connects the current Chrome page to local ACP-compatible coding agents. It runs as a Chrome side-panel extension, starts a local daemon through Chrome Native Messaging, and lets agents such as Gemini CLI, Qoder CLI, Codex CLI, Claude Agent, and GitHub Copilot CLI answer questions with browser context when you ask for it.

The project is currently a macOS/Chrome first release.

## What You Can Do

- Ask a local agent about the current page, selected text, URL, or open browser context.
- Keep browser context out of the user prompt body by writing dynamic page context to workspace temporary files.
- Switch between configured ACP agents from the side panel.
- View and switch agent models when the selected agent exposes model state.
- Trigger agent login flows, including browser/OAuth style methods and environment-variable API key methods.
- Configure page task templates for common selection actions.
- Inspect daemon, panel, session, and raw ACP logs from the debug drawer.

## Install

Prerequisites:

- macOS
- Google Chrome or another Chromium browser with compatible native messaging support
- Node.js 20 or newer
- pnpm 9

The release zip contains two pieces:

- A Chrome extension.
- A local Native Messaging host, required because Chrome extensions cannot start local CLI tools directly.

### Load the Extension

GitHub releases include `browser-acp-extension.zip`, which contains the built Chrome extension and the packaged native host.

Download it, unzip it, then:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the unzipped extension folder.
5. Keep the generated extension ID handy if the native host installer asks for it.

At this point the side panel can load, but it cannot talk to local agents until the native host is installed.

### Install the Native Host

The native host is the small local bridge that Chrome is allowed to launch through Native Messaging. It starts the Browser ACP daemon, and the daemon starts ACP-compatible CLI agents.

Run the installer from the unzipped release folder:

```bash
./install-native-host.command
```

If Chrome has not written extension preferences yet, pass the extension ID explicitly:

```bash
./install-native-host.command --extension-id <extension-id>
```

The installer writes:

- Packaged native host files: `~/Library/Application Support/browser-acp/native-host`
- Native host launcher: `~/Library/Application Support/browser-acp/bin/com.browser_acp.host`
- Chrome native messaging manifest: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browser_acp.host.json`

After installing the native host, reload the extension from `chrome://extensions/`, open the Browser ACP side panel, and select an agent.

## Build From Source

If you want to build the extension yourself instead of using the release zip:

```bash
git clone https://github.com/CodeKillerCoser/aionbrowser.git
cd aionbrowser
pnpm install
pnpm build
```

Then load `apps/browser-extension/dist` with Chrome's Load unpacked flow.

## Packaging Status

The current release zip is a macOS/Chrome unpacked-extension package. It includes the extension, the native host bundle, and `install-native-host.command`. A future release may add a signed macOS installer, but cloning the repository is no longer required for normal installation.

## Agent Setup

Open the side panel and use Agent settings to add or enable agents. Browser ACP can discover supported ACP agents from the public ACP registry and from local commands.

Common launch examples:

| Agent | Example command |
| --- | --- |
| Gemini CLI | `npx @google/gemini-cli --experimental-acp` |
| Qoder CLI | `npx @qoder-ai/qodercli --acp` |
| Codex CLI | `npx @zed-industries/codex-acp` |
| GitHub Copilot CLI | `npx @github/copilot --acp` |
| Claude Agent | depends on the installed Claude ACP command |

Agents may require their own login or API key setup. If an ACP agent returns an `env_var` auth method, Browser ACP shows a credential dialog for the required variables and optional extra key/value pairs.

## Usage

1. Open a web page.
2. Open the Browser ACP side panel.
3. Pick an agent.
4. Ask a question in the composer, or select text on the page and run a configured page task.
5. Use the model selector near the composer when the agent exposes switchable models.

The prompt sent to the agent includes a small pointer to a workspace-local browser context file when browser context is relevant. The full tab/page context is not pasted directly into every user message.

## Debugging

Use the Debug toggle in the side panel to open the right-side debug drawer. It shows:

- Extension background logs
- Panel logs
- Daemon logs
- Current session events
- Native host bootstrap state

Useful local files:

- Daemon log: `~/Library/Application Support/browser-acp/daemon.log`
- Daemon state: `~/Library/Application Support/browser-acp/daemon-state.json`
- Workspace temp browser context files: `<cwd>/.browser-acp/tmp/browser-contexts/`

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Run individual pieces during development:

```bash
pnpm dev:extension
pnpm dev:daemon
pnpm dev:native-host
```

Workspace layout:

- `apps/browser-extension`: Chrome extension, side panel, background worker, and content script
- `apps/acp-daemon`: Local HTTP/WebSocket daemon and session orchestration
- `apps/native-host`: Chrome Native Messaging host and daemon bootstrapper
- `packages/runtime-core`: Platform-neutral runtime and session contracts
- `packages/runtime-node`: Node process launch and ACP session wiring
- `packages/client-core`: Platform-neutral client state helpers
- `packages/ui-react`: Shared React UI pieces
- `packages/host-api`: Host-facing console contract
- `packages/shared-types`: Shared protocol and domain types
- `packages/config`: Shared runtime-safe constants

## Current Limitations

- The first release is optimized for macOS and Chrome.
- The extension is distributed as an unpacked Chrome extension zip, not a Chrome Web Store package.
- Agent availability, login behavior, and model lists depend on each ACP CLI's current implementation.
