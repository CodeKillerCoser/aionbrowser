import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";

class MockToolAgent {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
    };
  }

  async newSession() {
    return {
      sessionId: randomUUID(),
    };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async prompt(params) {
    const toolCallId = "tool-call-1";

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: "Read package.json",
        kind: "read",
        status: "pending",
        rawInput: {
          path: "package.json",
        },
      },
    });

    await this.connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: {
        toolCallId,
        title: "Read package.json",
        kind: "read",
        status: "pending",
        rawInput: {
          path: "package.json",
        },
      },
      options: [
        {
          optionId: "allow-once",
          kind: "allow_once",
          name: "Allow once",
        },
        {
          optionId: "reject-once",
          kind: "reject_once",
          name: "Reject once",
        },
      ],
    });

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        rawOutput: {
          name: "browser_acp",
        },
      },
    });

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Read package.json successfully.",
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

new acp.AgentSideConnection((connection) => new MockToolAgent(connection), stream);
