import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class MockQoderLoginAgent {
  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
      authMethods: [
        {
          id: "qodercli-login",
          name: "Use qodercli login",
          description: "Use your existing qodercli login for this agent.",
        },
      ],
    };
  }

  async newSession() {
    throw acp.RequestError.authRequired();
  }

  async authenticate() {
    throw new Error("run `qodercli /login` in the terminal");
  }

  async prompt() {
    return {
      stopReason: "end_turn",
    };
  }

  async cancel() {}
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection(() => new MockQoderLoginAgent(), stream);
