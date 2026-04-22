import type { RuntimeSessionCreateInput, RuntimeSessionLike } from "../session/runtimeSession.js";
import type { ResolvedAgent } from "@browser-acp/shared-types";

export interface RuntimeHostCreateInput {
  agent: ResolvedAgent;
  cwd: string;
  resumeSessionId?: string;
  runtime: Omit<RuntimeSessionCreateInput, "command" | "args" | "cwd" | "resumeSessionId">;
}

export interface RuntimeHost {
  create(input: RuntimeHostCreateInput): Promise<RuntimeSessionLike>;
}
