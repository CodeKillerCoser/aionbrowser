import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSession } from "../src/runtimeSession.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("RuntimeSession ACP logging", () => {
  it("logs sanitized raw ACP packets from the transport", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "browser-acp-runtime-log-"));
    tempDirs.push(cwd);
    const logs: Array<{ scope: string; message: string; details?: unknown }> = [];

    const session = await RuntimeSession.create({
      cwd,
      command: process.execPath,
      args: [resolve("../../apps/acp-daemon/tests/fixtures/mock-auth-model-agent.mjs")],
      env: {
        MOCK_AGENT_API_KEY: "secret-test-api-key",
      },
      onEvent: async () => undefined,
      logger: {
        log(scope, message, details) {
          logs.push({ scope, message, details });
        },
      },
      startupTimeoutMs: 5000,
    });

    try {
      const sentInitialize = logs.find((entry) =>
        entry.message === "runtime acp packet sent"
        && (entry.details as { packet?: { method?: string } } | undefined)?.packet?.method === "initialize"
      );
      const receivedInitialize = logs.find((entry) =>
        entry.message === "runtime acp packet received"
        && Array.isArray(
          (entry.details as { packet?: { result?: { authMethods?: unknown } } } | undefined)
            ?.packet?.result?.authMethods,
        )
      );

      expect(sentInitialize).toBeDefined();
      expect(receivedInitialize).toBeDefined();
      expect(receivedInitialize?.details).toMatchObject({
        direction: "received",
        packet: {
          result: {
            authMethods: [
              {
                id: "browser",
              },
              {
                id: "api-key",
                type: "env_var",
                vars: [
                  {
                    name: "MOCK_AGENT_API_KEY",
                  },
                ],
              },
            ],
          },
        },
      });
      expect(JSON.stringify(logs)).not.toContain("secret-test-api-key");
    } finally {
      await session.dispose();
    }
  }, 10000);

  it("includes ACP error details when authentication fails with an internal error", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "browser-acp-runtime-auth-error-"));
    tempDirs.push(cwd);

    await expect(
      RuntimeSession.create({
        cwd,
        command: process.execPath,
        args: [resolve("../../apps/acp-daemon/tests/fixtures/mock-auth-model-agent.mjs")],
        env: {
          MOCK_AGENT_AUTH_ERROR_DETAILS: "This account cannot use the selected OAuth method.",
        },
        authenticationMethodId: "browser",
        onEvent: async () => undefined,
        startupTimeoutMs: 5000,
      }),
    ).rejects.toThrow("This account cannot use the selected OAuth method.");
  }, 10000);
});
