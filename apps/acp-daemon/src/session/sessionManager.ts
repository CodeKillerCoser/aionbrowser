import { randomUUID } from "node:crypto";
import {
  SessionManager as CoreSessionManager,
  type SessionManagerOptions,
} from "@browser-acp/runtime-core";
import { createRuntimeHost } from "@browser-acp/runtime-node";
import { DEFAULT_MAX_ACTIVE_RUNTIMES } from "../config/daemonConfig.js";

export type {
  CreateSessionInput,
  SessionManagerOptions,
  SessionStoreRepository,
} from "@browser-acp/runtime-core";

export class SessionManager extends CoreSessionManager {
  constructor(options: SessionManagerOptions) {
    super({
      createTurnId: randomUUID,
      maxActiveRuntimes: DEFAULT_MAX_ACTIVE_RUNTIMES,
      runtimeHost: createRuntimeHost(),
      ...options,
    });
  }
}
