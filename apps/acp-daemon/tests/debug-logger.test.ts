import { describe, expect, it } from "vitest";
import { createDebugLogger } from "../src/debug/logger.js";

describe("debug logger", () => {
  it("keeps sanitized ACP packet structure deep enough for auth method diagnostics", () => {
    const logger = createDebugLogger();

    logger.log("runtime", "runtime acp packet received", {
      direction: "received",
      packet: {
        jsonrpc: "2.0",
        id: 0,
        result: {
          protocolVersion: 1,
          authMethods: [
            {
              id: "gemini-api-key",
              type: "env_var",
              vars: [
                {
                  name: "GEMINI_API_KEY",
                  secret: true,
                },
              ],
            },
          ],
        },
      },
    });

    expect(logger.entries()[0]?.details).toMatchObject({
      packet: {
        result: {
          authMethods: [
            {
              id: "gemini-api-key",
              type: "env_var",
              vars: [
                {
                  name: "GEMINI_API_KEY",
                },
              ],
            },
          ],
        },
      },
    });
  });
});
