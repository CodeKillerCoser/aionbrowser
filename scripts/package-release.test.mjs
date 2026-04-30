import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_COMMAND_FILE_NAME,
  RELEASE_ZIP_FILE_NAME,
  createInstallCommandScript,
  listReleasePackageEntries,
} from "./package-release.mjs";

const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("release packaging", () => {
  it("keeps the extension manifest at the package root and includes native host assets", () => {
    assert.equal(RELEASE_ZIP_FILE_NAME, "browser-acp-extension.zip");
    assert.deepEqual(listReleasePackageEntries(), [
      "manifest.json",
      "sidepanel.html",
      "assets/",
      "native-host/host.mjs",
      "native-host/daemon.mjs",
      "install-native-host.mjs",
      "install-native-host.command",
      "README-INSTALL.md",
    ]);
  });

  it("creates a macOS command wrapper that runs the packaged installer", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "browser-acp-release-script-"));
    tempDirs.push(rootDir);
    const commandPath = join(rootDir, INSTALL_COMMAND_FILE_NAME);

    await writeFile(commandPath, createInstallCommandScript(), "utf8");

    const script = await readFile(commandPath, "utf8");
    assert.match(script, /^#!\/bin\/sh/);
    assert.match(script, /install-native-host\.mjs/);
  });
});
