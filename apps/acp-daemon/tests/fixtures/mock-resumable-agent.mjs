import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";

class MockResumableAgent {
  constructor(connection) {
    this.connection = connection;
    this.resumedSessions = new Set();
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          resume: {},
        },
      },
    };
  }

  async newSession() {
    return {
      sessionId: randomUUID(),
    };
  }

  async loadSession(params) {
    this.resumedSessions.add(params.sessionId);
    return {
      sessionId: params.sessionId,
    };
  }

  async unstable_resumeSession(params) {
    this.resumedSessions.add(params.sessionId);
    return {
      sessionId: params.sessionId,
    };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async prompt(params) {
    const resumed = this.resumedSessions.has(params.sessionId);
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: resumed
            ? `Resumed session ${params.sessionId}`
            : `Fresh session ${params.sessionId}`,
        },
      },
    });

    return {
      stopReason: "end_turn",
    };
  }

  async cancel() {}
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);

new acp.AgentSideConnection((connection) => new MockResumableAgent(connection), stream);
