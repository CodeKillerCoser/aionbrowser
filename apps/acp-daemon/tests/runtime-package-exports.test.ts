import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runtimePackages = [
  "@browser-acp/runtime-core",
  "@browser-acp/runtime-node",
] as const;

describe("runtime package exports", () => {
  it("point daemon runtime imports at built JavaScript files", () => {
    for (const packageName of runtimePackages) {
      const packageDir = packageName.replace("@browser-acp/", "");
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), "../../packages", packageDir, "package.json"), "utf8"),
      ) as {
        exports: {
          ".": {
            types: string;
            default: string;
          };
        };
      };

      expect(packageJson.exports["."].types).toBe("./dist/index.d.ts");
      expect(packageJson.exports["."].default).toBe("./dist/index.js");
    }
  });
});
