import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class MockAuthModelAgent {
  constructor(connection) {
    this.connection = connection;
    this.authenticated = Boolean(process.env.MOCK_AGENT_API_KEY);
    this.emptyModels = process.env.MOCK_AGENT_EMPTY_MODELS === "1";
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
        {
          type: "env_var",
          id: "api-key",
          name: "Use API key",
          description: "Set an API key in the agent environment.",
          link: "https://example.com/api-key",
          vars: [
            {
              name: "MOCK_AGENT_API_KEY",
              label: "Mock API key",
              secret: true,
            },
          ],
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
    if (process.env.MOCK_AGENT_AUTH_ERROR_DETAILS) {
      throw acp.RequestError.internalError({
        details: process.env.MOCK_AGENT_AUTH_ERROR_DETAILS,
      });
    }

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
    if (this.emptyModels) {
      return {
        currentModelId: "",
        availableModels: [],
      };
    }

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
