import "server-only";
import type { ModelAssignment, ModelLimit, MultiModelConfigDoc } from "@/lib/multi-model-types";

export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 250
  ) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const reachabilityCache = new TtlCache<ModelLimit>(60_000, 300);
const configCache = new TtlCache<MultiModelConfigDoc>(30_000, 200);

export function getReachabilityCacheKey(userId: string, assignment: ModelAssignment): string {
  // Raw field values only: resolveEndpoint() can throw on an unsafe endpoint,
  // and a cache lookup must never fail the whole limits check.
  const endpoint = assignment.apiEndpoint || assignment.localEndpoint || assignment.endpoint || "";
  return `${userId}-${assignment.connectionType}-${assignment.provider}-${assignment.modelName}-${endpoint}-${assignment.apiKey?.slice(-4) || ""}`;
}

export function getCachedReachability(userId: string, assignment: ModelAssignment): ModelLimit | null {
  return reachabilityCache.get(getReachabilityCacheKey(userId, assignment));
}

export function setCachedReachability(userId: string, assignment: ModelAssignment, result: ModelLimit): void {
  reachabilityCache.set(getReachabilityCacheKey(userId, assignment), result);
}

export function getCachedConfig(userId: string): MultiModelConfigDoc | null {
  return configCache.get(userId);
}

export function setCachedConfig(userId: string, doc: MultiModelConfigDoc): void {
  configCache.set(userId, doc);
}

export function invalidateCachedConfig(userId: string): void {
  configCache.delete(userId);
}
