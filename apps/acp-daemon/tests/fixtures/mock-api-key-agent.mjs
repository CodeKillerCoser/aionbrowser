import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class MockApiKeyAgent {
  constructor() {
    this.authenticated = Boolean(process.env.GEMINI_API_KEY);
    this.chatInitialized = false;
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
      authMethods: [
        {
          type: "env_var",
          id: "gemini-api-key",
          name: "Use Gemini API key",
          description: "Requires setting the `GEMINI_API_KEY` environment variable.",
          vars: [],
        },
        {
          id: "gemini-description-only",
          name: "Description only API key",
          description: "Requires setting the `GEMINI_API_KEY` environment variable.",
        },
        {
          id: "gemini-oauth",
          name: "Login with Google",
          description: "Open the Google login flow.",
        },
      ],
    };
  }

  async newSession() {
    this.chatInitialized = true;
    if (!this.authenticated) {
      return {
        sessionId: "api-key-session",
        models: {
          currentModelId: "",
          availableModels: [],
        },
      };
    }

    return {
      sessionId: "api-key-session",
      models: {
        currentModelId: "gemini-2.5-pro",
        availableModels: [
          {
            modelId: "gemini-2.5-pro",
            name: "Gemini 2.5 Pro",
          },
        ],
      },
    };
  }

  async authenticate(params) {
    if (params.methodId === "gemini-api-key") {
      throw new Error("Gemini API key auth should be handled through environment variables.");
    }
    if (params.methodId === "gemini-oauth") {
      if (!this.chatInitialized) {
        throw new Error("Chat not initialized");
      }
      this.authenticated = true;
    }
    return {};
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
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection(() => new MockApiKeyAgent(), stream);
