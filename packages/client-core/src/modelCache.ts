import { LRUCache } from "lru-cache";
import type { ModelState } from "@browser-acp/shared-types";

export const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const EMPTY_MODEL_STATE = Object.freeze({});
type CachedModelState = ModelState | typeof EMPTY_MODEL_STATE;

export interface ModelCache {
  has(agentId: string): boolean;
  get(agentId: string): ModelState | null;
  set(agentId: string, models: ModelState | null): void;
  delete(agentId: string): void;
}

export function createModelCache({
  ttlMs = MODEL_CACHE_TTL_MS,
  max = 32,
}: {
  ttlMs?: number;
  max?: number;
} = {}): ModelCache {
  const cache = new LRUCache<string, CachedModelState>({
    max,
    ttl: ttlMs,
  });

  return {
    has(agentId) {
      return cache.has(agentId);
    },
    get(agentId) {
      const cached = cache.get(agentId);
      if (!cached || cached === EMPTY_MODEL_STATE) {
        return null;
      }

      return cached as ModelState;
    },
    set(agentId, models) {
      cache.set(agentId, models ?? EMPTY_MODEL_STATE);
    },
    delete(agentId) {
      cache.delete(agentId);
    },
  };
}
