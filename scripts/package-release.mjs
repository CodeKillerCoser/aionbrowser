#!/usr/bin/env node
import { build } from "esbuild";
import { createWriteStream } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RELEASE_ZIP_FILE_NAME = "browser-acp-extension.zip";
export const INSTALL_COMMAND_FILE_NAME = "install-native-host.command";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packageDir = join(repoRoot, ".release", "browser-acp");
const extensionDistDir = join(repoRoot, "apps/browser-extension/dist");

export function listReleasePackageEntries() {
  return [
    "manifest.json",
    "sidepanel.html",
    "assets/",
    "native-host/host.mjs",
    "native-host/daemon.mjs",
    "install-native-host.mjs",
    INSTALL_COMMAND_FILE_NAME,
    "README-INSTALL.md",
  ];
}

export function createInstallCommandScript() {
  return `#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /usr/bin/env node "$DIR/install-native-host.mjs" "$@"
`;
}

export function createInstallReadme(version) {
  return `# Browser ACP ${version} Install

This folder is both the Chrome extension and the local native host installer.

## Install

1. Open \`chrome://extensions/\`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.
5. Run \`./install-native-host.command\` from this folder.

If the installer cannot discover the extension ID, copy it from \`chrome://extensions/\` and run:

\`\`\`bash
./install-native-host.command --extension-id <extension-id>
\`\`\`

The installer copies the packaged native host into:

\`\`\`text
~/Library/Application Support/browser-acp/native-host
\`\`\`

Then it writes Chrome's native messaging manifest so the extension can start the local daemon.
`;
}

async function main() {
  const rootPackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  const version = rootPackage.version ?? "0.0.0";
  const zipPath = join(repoRoot, RELEASE_ZIP_FILE_NAME);

  await rm(packageDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(join(packageDir, "native-host"), { recursive: true });

  await cp(extensionDistDir, packageDir, { recursive: true });

  await bundleNodeEntry({
    entryPoint: join(repoRoot, "apps/native-host/src/index.ts"),
    outfile: join(packageDir, "native-host/host.mjs"),
  });
  await bundleNodeEntry({
    entryPoint: join(repoRoot, "apps/acp-daemon/src/index.ts"),
    outfile: join(packageDir, "native-host/daemon.mjs"),
  });
  await bundleNodeEntry({
    entryPoint: join(repoRoot, "apps/native-host/src/installManifest.ts"),
    outfile: join(packageDir, "install-native-host.mjs"),
  });

  const commandPath = join(packageDir, INSTALL_COMMAND_FILE_NAME);
  await writeFile(commandPath, createInstallCommandScript(), "utf8");
  await chmod(commandPath, 0o755);
  await writeFile(join(packageDir, "README-INSTALL.md"), createInstallReadme(`v${version}`), "utf8");

  await createZip({ cwd: packageDir, outputPath: zipPath });
  process.stdout.write(`${RELEASE_ZIP_FILE_NAME}\n`);
}

async function bundleNodeEntry({ entryPoint, outfile }) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    banner: {
      js: `#!/usr/bin/env node
import { createRequire as __browserAcpCreateRequire } from "node:module";
const require = __browserAcpCreateRequire(import.meta.url);`,
    },
  });
  await chmod(outfile, 0o755);
}

function createZip({ cwd, outputPath }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("zip", ["-r", outputPath, "."], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = createWriteStream(join(repoRoot, ".release", `${basename(outputPath)}.log`));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("error", reject);
    child.on("close", (code) => {
      log.end();
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`zip failed with exit code ${code}`));
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
