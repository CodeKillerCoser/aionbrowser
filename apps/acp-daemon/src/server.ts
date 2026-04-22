import { join } from "node:path";
import { DAEMON_BASE_ORIGIN, DAEMON_HOST, DAEMON_LOG_FILE_NAME } from "@browser-acp/config";
import { createSessionService } from "./application/sessionService.js";
import { DEFAULT_MAX_ACTIVE_RUNTIMES } from "./config/daemonConfig.js";
import { readPersistedDebugLogs } from "./debug/persistedLogs.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { parse } from "node:url";
import type {
  BrowserContextBundle,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
  ResolvedAgent,
  SessionSocketClientMessage,
  SessionSocketServerMessage,
} from "@browser-acp/shared-types";
import { WebSocketServer } from "ws";
import { scanBuiltinAgentSpecCandidates } from "./agents/builtinCandidates.js";
import { AgentSpecStore } from "./agents/configStore.js";
import { createDebugLogger, type DebugLogger } from "./debug/logger.js";
import { SessionManager } from "./session/sessionManager.js";
import { SessionStore } from "./store/sessionStore.js";

interface CreateDaemonAppOptions {
  token: string;
  port: number;
  rootDir: string;
  defaultCwd: string;
  listAgents: () => Promise<ResolvedAgent[]>;
  logger?: DebugLogger;
}

interface StartedDaemonApp {
  port: number;
}

export function createDaemonApp(options: CreateDaemonAppOptions) {
  const store = new SessionStore(options.rootDir);
  const agentSpecStore = new AgentSpecStore(options.rootDir);
  const logger = options.logger ?? createDebugLogger();
  const logPath = join(options.rootDir, DAEMON_LOG_FILE_NAME);
  const manager = new SessionManager({
    store,
    defaultCwd: options.defaultCwd,
    logger,
    maxActiveRuntimes: DEFAULT_MAX_ACTIVE_RUNTIMES,
    resolveAgent: async (agentId) => {
      const agents = await options.listAgents();
      return agents.find((entry) => entry.id === agentId) ?? null;
    },
  });
  const sessions = createSessionService({ manager });

  const wsServer = new WebSocketServer({ noServer: true });
  const httpServer = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", DAEMON_BASE_ORIGIN);
    logger.log("http", "daemon HTTP request received", {
      method,
      path: url.pathname,
    });

    try {
      if (!isAuthorized(request.headers.authorization, options.token)) {
        logger.log("http", "daemon HTTP request unauthorized", {
          method,
          path: url.pathname,
        });
        writeJson(response, 401, { error: "Unauthorized" });
        return;
      }

      if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/agents") {
        writeJson(response, 200, await options.listAgents());
        return;
      }

      if (method === "GET" && url.pathname === "/agent-specs") {
        writeJson(response, 200, await agentSpecStore.list());
        return;
      }

      if (method === "GET" && url.pathname === "/agent-spec-candidates") {
        writeJson(response, 200, await scanBuiltinAgentSpecCandidates({
          configuredSpecs: await agentSpecStore.list(),
          logger,
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/agent-specs") {
        const body = await readJsonBody(request) as unknown as ExternalAgentSpecInput;
        writeJson(response, 200, await agentSpecStore.createExternalAgent(body));
        return;
      }

      const agentSpecMatch = url.pathname.match(/^\/agent-specs\/([^/]+)$/);
      if (agentSpecMatch && method === "PUT") {
        const body = await readJsonBody(request) as unknown as ExternalAgentSpecPatch;
        writeJson(response, 200, await agentSpecStore.updateExternalAgent(agentSpecMatch[1], body));
        return;
      }

      if (agentSpecMatch && method === "DELETE") {
        await agentSpecStore.delete(agentSpecMatch[1]);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/sessions") {
        writeJson(response, 200, await sessions.list());
        return;
      }

      if (method === "GET" && url.pathname === "/debug/logs") {
        const persistedLogs = await readPersistedDebugLogs(logPath);
        writeJson(response, 200, persistedLogs.length > 0 ? persistedLogs : logger.entries());
        return;
      }

      if (method === "POST" && url.pathname === "/sessions") {
        const body = await readJsonBody(request);
        const context = body.context as BrowserContextBundle;
        logger.log("http", "create session HTTP request received", {
          agentId: body.agentId,
          pageTitle: context?.title,
        });
        const agents = await options.listAgents();
        const agent = agents.find((entry) => entry.id === body.agentId);

        if (!agent) {
          writeJson(response, 404, { error: `Agent ${body.agentId} not found` });
          return;
        }

        const summary = await sessions.create({
          agent,
          context,
        });

        writeJson(response, 200, summary);
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      logger.log("http", "daemon HTTP request failed", error);
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  wsServer.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "/", DAEMON_BASE_ORIGIN);
    const sessionId = url.pathname.split("/").pop();
    logger.log("ws", "websocket session connected", {
      sessionId,
      path: url.pathname,
    });

    if (!sessionId) {
      socket.send(JSON.stringify({ type: "error", error: "Missing session id" } satisfies SessionSocketServerMessage));
      socket.close();
      return;
    }

    socket.on("message", async (buffer: Buffer) => {
      try {
        const message = JSON.parse(buffer.toString()) as SessionSocketClientMessage;
        logger.log("ws", "websocket client message received", {
          sessionId,
          type: message.type,
        });
        if (message.type === "sendPrompt" && message.prompt) {
          logger.log("ws", "websocket prompt received", {
            sessionId,
            agentId: message.prompt.agentId,
            textLength: message.prompt.text.length,
          });
          await manager.sendPrompt(message.prompt);
          return;
        }

        if (message.type === "cancelTurn") {
          logger.log("ws", "websocket cancel received", {
            sessionId,
          });
          await manager.cancel(sessionId);
          return;
        }

        if (message.type === "resolvePermission" && message.decision) {
          logger.log("ws", "websocket permission decision received", {
            sessionId,
            permissionId: message.decision.permissionId,
            outcome: message.decision.outcome,
            optionId: message.decision.optionId,
          });
          await manager.resolvePermission(sessionId, message.decision);
        }
      } catch (error) {
        logger.log("ws", "websocket message handling failed", error);
        socket.send(JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        } satisfies SessionSocketServerMessage));
      }
    });

    const unsubscribe = sessions.subscribe(sessionId, (event) => {
      socket.send(JSON.stringify({ type: "event", event } satisfies SessionSocketServerMessage));
    });

    const transcript = await sessions.readTranscript(sessionId);
    transcript.forEach((event) => {
      socket.send(JSON.stringify({ type: "event", event } satisfies SessionSocketServerMessage));
    });

    socket.on("close", () => {
      logger.log("ws", "websocket session closed", {
        sessionId,
      });
      unsubscribe();
    });
  });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const parsed = parse(request.url ?? "", true);
    if (parsed.query.token !== options.token) {
      logger.log("ws", "websocket upgrade unauthorized", {
        path: parsed.pathname,
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!parsed.pathname?.startsWith("/sessions/")) {
      logger.log("ws", "websocket upgrade path not found", {
        path: parsed.pathname,
      });
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (websocket) => {
      wsServer.emit("connection", websocket, request);
    });
  });

  return {
    async start(): Promise<StartedDaemonApp> {
      await new Promise<void>((resolve) => {
        httpServer.listen(options.port, DAEMON_HOST, () => resolve());
      });

      const address = httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to determine daemon port");
      }

      return {
        port: address.port,
      };
    },
    async stop(): Promise<void> {
      await manager.dispose();
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          httpServer.close((httpError) => {
            if (httpError) {
              reject(httpError);
              return;
            }

            resolve();
          });
        });
      });
    },
  };
}

function isAuthorized(headerValue: string | undefined, token: string): boolean {
  return headerValue === `Bearer ${token}`;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}
