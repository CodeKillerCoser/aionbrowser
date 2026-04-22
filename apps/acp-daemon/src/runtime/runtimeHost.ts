import { RuntimeSession } from "../session/runtimeSession.js";
import type { RuntimeHost } from "./types.js";

export function createRuntimeHost(): RuntimeHost {
  return {
    create(input) {
      return RuntimeSession.create({
        ...input.runtime,
        cwd: input.cwd,
        command: input.agent.launchCommand,
        args: input.agent.launchArgs,
        resumeSessionId: input.resumeSessionId,
      });
    },
  };
}
