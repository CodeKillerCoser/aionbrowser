import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentSpec,
  ExternalAcpAgentSpec,
  ExternalAgentSpecInput,
  ExternalAgentSpecPatch,
} from "@browser-acp/shared-types";

const AGENT_SPECS_FILE_NAME = "agent-specs.json";

export class AgentSpecStore {
  private readonly configPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(rootDir: string) {
    this.configPath = join(rootDir, AGENT_SPECS_FILE_NAME);
  }

  async list(): Promise<AgentSpec[]> {
    await this.writeChain;
    return this.readList();
  }

  private async readList(): Promise<AgentSpec[]> {
    if (!existsSync(this.configPath)) {
      return [];
    }

    const raw = await readFile(this.configPath, "utf8");
    return this.parseConfig(raw);
  }

  async createExternalAgent(input: ExternalAgentSpecInput): Promise<ExternalAcpAgentSpec> {
    const now = new Date().toISOString();
    const next: ExternalAcpAgentSpec = {
      id: `external-${randomUUID()}`,
      name: input.name.trim(),
      kind: "external-acp",
      enabled: input.enabled ?? true,
      description: input.description,
      icon: input.icon,
      launch: {
        command: input.launchCommand.trim(),
        args: input.launchArgs,
      },
      createdAt: now,
      updatedAt: now,
    };

    validateExternalAgent(next);
    return this.mutate(async (specs) => {
      await this.save([next, ...specs]);
      return next;
    });
  }

  async updateExternalAgent(id: string, patch: ExternalAgentSpecPatch): Promise<ExternalAcpAgentSpec> {
    return this.mutate(async (specs) => {
      const index = specs.findIndex((spec) => spec.id === id);
      if (index < 0) {
        throw new Error(`Agent spec ${id} was not found`);
      }

      const current = specs[index];
      if (current.kind !== "external-acp") {
        throw new Error(`Agent spec ${id} is not an external ACP agent`);
      }

      const next: ExternalAcpAgentSpec = {
        ...current,
        name: patch.name === undefined ? current.name : patch.name.trim(),
        enabled: patch.enabled ?? current.enabled,
        description: patch.description === undefined ? current.description : patch.description ?? undefined,
        icon: patch.icon === undefined ? current.icon : patch.icon ?? undefined,
        launch: {
          ...current.launch,
          command: patch.launchCommand === undefined ? current.launch.command : patch.launchCommand.trim(),
          args: patch.launchArgs ?? current.launch.args,
        },
        updatedAt: new Date().toISOString(),
      };

      validateExternalAgent(next);
      specs[index] = next;
      await this.save(specs);
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.mutate(async (specs) => {
      await this.save(specs.filter((spec) => spec.id !== id));
    });
  }

  private async mutate<T>(operation: (specs: AgentSpec[]) => Promise<T>): Promise<T> {
    const run = this.writeChain.then(async () => operation(await this.readList()));
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async save(specs: AgentSpec[]): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(specs, null, 2)}\n`, "utf8");
    await rename(tempPath, this.configPath);
  }

  private async parseConfig(raw: string): Promise<AgentSpec[]> {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Agent spec config must be a JSON array");
      }
      return parsed as AgentSpec[];
    } catch (error) {
      const repaired = tryParseJsonArrayPrefix(raw);
      if (!repaired) {
        throw error;
      }

      await this.save(repaired);
      return repaired;
    }
  }
}

function tryParseJsonArrayPrefix(raw: string): AgentSpec[] | null {
  const endIndex = findJsonArrayEnd(raw);
  if (endIndex < 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(0, endIndex + 1)) as unknown;
    return Array.isArray(parsed) ? parsed as AgentSpec[] : null;
  } catch {
    return null;
  }
}

function findJsonArrayEnd(raw: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!started) {
      if (/\s/.test(char)) {
        continue;
      }
      if (char !== "[") {
        return -1;
      }
      started = true;
      depth = 1;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function validateExternalAgent(spec: ExternalAcpAgentSpec): void {
  if (!spec.name) {
    throw new Error("Agent name is required");
  }

  if (!spec.launch.command) {
    throw new Error("Agent launch command is required");
  }
}
