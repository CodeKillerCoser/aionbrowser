import { RuntimeSession } from "../session/runtimeSession.js";
import { prepareAgentLaunch } from "./agentLaunch.js";
import type { RuntimeHost } from "./types.js";

export function createRuntimeHost(): RuntimeHost {
  return {
    async create(input) {
      const launch = await prepareAgentLaunch({
        agent: input.agent,
        cwd: input.cwd,
      });
      return RuntimeSession.create({
        ...input.runtime,
        cwd: input.cwd,
        command: launch.command,
        args: launch.args,
        env: launch.env,
        newSessionAdditionalDirectories: launch.newSessionAdditionalDirectories,
        newSessionMeta: launch.newSessionMeta,
        newSessionSettings: launch.newSessionSettings,
        promptPrefix: launch.promptPrefix,
        resumeSessionId: input.resumeSessionId,
      });
    },
  };
}
