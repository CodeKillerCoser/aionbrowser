import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { NativeHostBootstrapRequest, NativeHostBootstrapResponse } from "@browser-acp/shared-types";
import { ensureDaemonRunning, getDaemonStatus, getDefaultRootDir } from "./daemonBootstrap.js";
import { appendRootDebugLog } from "./debugLog.js";

const rootDir = getDefaultRootDir();

for await (const request of readNativeMessages()) {
  await appendRootDebugLog(rootDir, "native-host", "native host request received", {
    command: request.command,
  });
  const response = await handleRequest(request);
  await appendRootDebugLog(rootDir, "native-host", "native host response ready", {
    command: request.command,
    ok: response.ok,
    port: response.port,
    pid: response.pid,
    message: response.message,
  });
  writeNativeMessage(response);
}

async function handleRequest(
  request: NativeHostBootstrapRequest,
): Promise<NativeHostBootstrapResponse> {
  if (request.command === "ensureDaemon") {
    return ensureDaemonRunning({
      rootDir,
      defaultCwd: process.env.HOME || homedir(),
    });
  }

  if (request.command === "getDaemonStatus") {
    return getDaemonStatus(rootDir);
  }

  if (request.command === "openLogs") {
    const status = await getDaemonStatus(rootDir);
    if (status.logPath) {
      await appendRootDebugLog(rootDir, "native-host", "opening log file in Finder", {
        logPath: status.logPath,
      });
      const child = spawn("open", [status.logPath], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }
    return status;
  }

  await appendRootDebugLog(rootDir, "native-host", "unsupported native host command received", {
    command: request.command,
  });
  return {
    ok: false,
    message: `Unsupported command: ${String(request.command)}`,
  };
}

async function* readNativeMessages(): AsyncIterable<NativeHostBootstrapRequest> {
  const stdin = process.stdin;

  while (true) {
    const header = await readExactly(stdin, 4);
    if (!header) {
      return;
    }

    const length = header.readUInt32LE(0);
    const body = await readExactly(stdin, length);
    if (!body) {
      return;
    }

    yield JSON.parse(body.toString("utf8")) as NativeHostBootstrapRequest;
  }
}

function writeNativeMessage(message: NativeHostBootstrapResponse): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function readExactly(stream: NodeJS.ReadStream, byteLength: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;

    const onReadable = () => {
      let chunk: Buffer | null;
      while ((chunk = stream.read(byteLength - total)) !== null) {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= byteLength) {
          cleanup();
          resolve(Buffer.concat(chunks, total));
          return;
        }
      }
    };

    const onEnd = () => {
      cleanup();
      resolve(undefined);
    };

    const cleanup = () => {
      stream.off("readable", onReadable);
      stream.off("end", onEnd);
    };

    stream.on("readable", onReadable);
    stream.on("end", onEnd);
    onReadable();
  });
}
