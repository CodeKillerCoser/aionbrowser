import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSpecStore } from "../src/agents/configStore.js";
import { createAgentRegistry } from "../src/agents/registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("AgentSpecStore and AgentRegistry", () => {
  it("persists external ACP agent specs and exposes them as launchable agents", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-specs-"));
    tempDirs.push(rootDir);
    const store = new AgentSpecStore(rootDir);
    const registry = createAgentRegistry(store);

    const created = await store.createExternalAgent({
      name: "Local Forge",
      launchCommand: "/usr/local/bin/forge-agent",
      launchArgs: ["--acp", "--profile", "default"],
      icon: {
        kind: "url",
        value: "https://example.com/forge.svg",
      },
    });

    const agents = await registry.listAgents();

    expect(created).toMatchObject({
      name: "Local Forge",
      kind: "external-acp",
      enabled: true,
    });
    expect(agents).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Local Forge",
        source: "user",
        status: "launchable",
        icon: "https://example.com/forge.svg",
        launchCommand: "/usr/local/bin/forge-agent",
        launchArgs: ["--acp", "--profile", "default"],
      }),
    ]);
  });

  it("does not expose disabled external agent specs", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-specs-"));
    tempDirs.push(rootDir);
    const store = new AgentSpecStore(rootDir);
    const registry = createAgentRegistry(store);

    await store.createExternalAgent({
      name: "Hidden Agent",
      launchCommand: "hidden-agent",
      launchArgs: [],
      enabled: false,
    });

    await expect(registry.listAgents()).resolves.toEqual([]);
  });

  it("serializes concurrent writes when multiple agents are added at once", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-specs-"));
    tempDirs.push(rootDir);
    const store = new AgentSpecStore(rootDir);

    await Promise.all([
      store.createExternalAgent({
        name: "Agent One",
        launchCommand: "agent-one",
        launchArgs: ["--acp"],
      }),
      store.createExternalAgent({
        name: "Agent Two",
        launchCommand: "agent-two",
        launchArgs: ["--acp"],
      }),
      store.createExternalAgent({
        name: "Agent Three",
        launchCommand: "agent-three",
        launchArgs: ["--acp"],
      }),
    ]);

    const specs = await store.list();

    expect(specs).toHaveLength(3);
    expect(specs.map((spec) => spec.name).sort()).toEqual([
      "Agent One",
      "Agent Three",
      "Agent Two",
    ]);
  });

  it("repairs a config file that has a valid JSON array followed by a stale write fragment", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "browser-acp-agent-specs-"));
    tempDirs.push(rootDir);
    const configPath = join(rootDir, "agent-specs.json");
    const store = new AgentSpecStore(rootDir);

    writeFileSync(
      configPath,
      `[
  {
    "id": "external-existing",
    "name": "Existing Agent",
    "kind": "external-acp",
    "enabled": true,
    "launch": {
      "command": "existing-agent",
      "args": []
    },
    "createdAt": "2026-04-20T00:00:00.000Z",
    "updatedAt": "2026-04-20T00:00:00.000Z"
  }
]
1:46.339Z"
  }
]`,
      "utf8",
    );

    const specs = await store.list();

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: "external-existing",
      name: "Existing Agent",
    });
    expect(() => JSON.parse(readFileSync(configPath, "utf8"))).not.toThrow();
  });
});
