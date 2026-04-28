import { describe, expect, it } from "vitest";
import type { ModelState } from "@browser-acp/shared-types";
import { createModelCache } from "../src/index.js";

const models: ModelState = {
  currentModelId: "fast",
  availableModels: [
    {
      modelId: "fast",
      name: "Fast",
      description: null,
    },
  ],
};

describe("model cache", () => {
  it("keeps model state in memory only until the configured TTL expires", async () => {
    const cache = createModelCache({ ttlMs: 5 });

    cache.set("agent-1", models);
    expect(cache.get("agent-1")).toEqual(models);

    await new Promise((resolve) => setTimeout(resolve, 8));

    expect(cache.get("agent-1")).toBeNull();
  });
});
