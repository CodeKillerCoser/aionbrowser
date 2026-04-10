import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_ACP_APP_SUPPORT_DIR_NAME,
  BROWSER_ACP_EXTENSION_NAME,
  BROWSER_ACP_NATIVE_HOST_NAME,
} from "@browser-acp/config";

export interface NativeHostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
}

interface CreateManifestOptions {
  hostPath: string;
  extensionIds: string[];
}

interface InstallManifestOptions {
  extensionIds?: string[];
  chromeRoot?: string;
  hostRootDir?: string;
  nodePath?: string;
}

const HOST_NAME = BROWSER_ACP_NATIVE_HOST_NAME;
const EXTENSION_NAME = BROWSER_ACP_EXTENSION_NAME;

export function collectExtensionIdsFromPreferences(preferencePayloads: unknown[]): string[] {
  const extensionIds = new Set<string>();

  for (const payload of preferencePayloads) {
    const settings = getExtensionSettings(payload);
    if (!settings) {
      continue;
    }

    for (const [extensionId, value] of Object.entries(settings)) {
      if (value?.manifest?.name === EXTENSION_NAME) {
        extensionIds.add(extensionId);
      }
    }
  }

  return [...extensionIds];
}

export function createNativeHostManifest({
  hostPath,
  extensionIds,
}: CreateManifestOptions): NativeHostManifest {
  return {
    name: HOST_NAME,
    description: "Native messaging host for the Browser ACP side panel",
    path: hostPath,
    type: "stdio",
    allowed_origins: extensionIds.map((extensionId) => `chrome-extension://${extensionId}/`),
  };
}

export async function discoverChromeExtensionIds(
  chromeRoot = join(homedir(), "Library", "Application Support", "Google", "Chrome"),
): Promise<string[]> {
  const preferencePaths = [
    join(chromeRoot, "Default", "Secure Preferences"),
    join(chromeRoot, "Default", "Preferences"),
  ];

  try {
    const profiles = await import("node:fs/promises").then(({ readdir }) =>
      readdir(chromeRoot, { withFileTypes: true }),
    );
    for (const profile of profiles) {
      if (!profile.isDirectory()) {
        continue;
      }

      if (profile.name === "Default" || profile.name.startsWith("Profile ")) {
        preferencePaths.push(
          join(chromeRoot, profile.name, "Secure Preferences"),
          join(chromeRoot, profile.name, "Preferences"),
        );
      }
    }
  } catch {
    // Ignore missing Chrome root.
  }

  const payloads: unknown[] = [];
  const seenPaths = new Set<string>();

  for (const preferencePath of preferencePaths) {
    if (seenPaths.has(preferencePath) || !existsSync(preferencePath)) {
      continue;
    }

    seenPaths.add(preferencePath);
    try {
      const raw = await readFile(preferencePath, "utf8");
      payloads.push(JSON.parse(raw) as unknown);
    } catch {
      // Ignore unreadable preference payloads.
    }
  }

  return collectExtensionIdsFromPreferences(payloads);
}

export async function installChromeNativeHost(
  options: InstallManifestOptions = {},
): Promise<{
  extensionIds: string[];
  launcherPath: string;
  manifestPath: string;
}> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const nativeHostEntry = resolve(currentDir, "../dist/index.js");
  if (!existsSync(nativeHostEntry)) {
    throw new Error("Native host dist/index.js is missing. Run pnpm build before installing the native host.");
  }

  const extensionIds = [
    ...new Set(
      (options.extensionIds && options.extensionIds.length > 0
        ? options.extensionIds
        : await discoverChromeExtensionIds(options.chromeRoot))
          .filter((value) => value.length > 0),
    ),
  ];

  if (extensionIds.length === 0) {
    throw new Error(
      "Could not find a loaded Browser ACP extension in Chrome profiles. Re-run with --extension-id <your-extension-id>.",
    );
  }

  const hostRootDir = options.hostRootDir ?? join(homedir(), "Library", "Application Support", BROWSER_ACP_APP_SUPPORT_DIR_NAME);
  const manifestDir = join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  const launcherPath = join(hostRootDir, "bin", HOST_NAME);
  const manifestPath = join(manifestDir, `${HOST_NAME}.json`);
  const nodePath = options.nodePath ?? process.execPath;

  await mkdir(dirname(launcherPath), { recursive: true });
  await mkdir(manifestDir, { recursive: true });

  const launcherSource = createLauncherScript({
    entryPath: nativeHostEntry,
    nodePath,
  });

  await writeFile(launcherPath, launcherSource, "utf8");
  await chmod(launcherPath, 0o755);

  const manifest = createNativeHostManifest({
    hostPath: launcherPath,
    extensionIds,
  });

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    extensionIds,
    launcherPath,
    manifestPath,
  };
}

function createLauncherScript({
  entryPath,
  nodePath,
}: {
  entryPath: string;
  nodePath: string;
}): string {
  return `#!/bin/sh
exec "${nodePath}" "${entryPath}"
`;
}

function getExtensionSettings(payload: unknown): Record<string, { manifest?: { name?: string } }> | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const extensions = "extensions" in payload ? payload.extensions : undefined;
  if (!extensions || typeof extensions !== "object") {
    return undefined;
  }

  const settings = "settings" in extensions ? extensions.settings : undefined;
  if (!settings || typeof settings !== "object") {
    return undefined;
  }

  return settings as Record<string, { manifest?: { name?: string } }>;
}

function parseCliArgs(argv: string[]): { extensionIds: string[] } {
  const extensionIds: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--extension-id" && argv[index + 1]) {
      extensionIds.push(argv[index + 1]);
      index += 1;
    }
  }

  return { extensionIds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await installChromeNativeHost({
    extensionIds: args.extensionIds,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
