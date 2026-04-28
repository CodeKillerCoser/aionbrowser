import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class MockAuthModelAgent {
  constructor(connection) {
    this.connection = connection;
    this.authenticated = false;
    this.currentModelId = "fast";
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
      authMethods: [
        {
          id: "browser",
          name: "Browser login",
          description: "Open the agent login flow",
        },
      ],
    };
  }

  async newSession() {
    if (!this.authenticated) {
      throw acp.RequestError.authRequired();
    }

    return {
      sessionId: "auth-model-session",
      models: this.modelState(),
    };
  }

  async authenticate(params) {
    if (params.methodId !== "browser") {
      throw new Error(`Unexpected auth method: ${params.methodId}`);
    }

    this.authenticated = true;
    return {};
  }

  async unstable_setSessionModel(params) {
    this.currentModelId = params.modelId;
    return {
      models: this.modelState(),
    };
  }

  async setSessionMode() {
    return {};
  }

  async prompt() {
    return {
      stopReason: "end_turn",
    };
  }

  async cancel() {}

  modelState() {
    return {
      currentModelId: this.currentModelId,
      availableModels: [
        {
          modelId: "fast",
          name: "Fast",
          description: "Lower latency model",
        },
        {
          modelId: "smart",
          name: "Smart",
          description: "Higher quality model",
        },
      ],
    };
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection((connection) => new MockAuthModelAgent(connection), stream);
