import { createHash } from "node:crypto";
import type { AnalysisPreferences, PostContext } from "@kavannah/shared";

/** Minimal in-memory TTL cache (single process, hackathon scale). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Cache key: post URL + a hash of the (normalized) preferences. */
export function analysisCacheKey(post: PostContext, preferences: AnalysisPreferences | undefined): string {
  const normalized = {
    trustedDomains: [...(preferences?.trustedDomains ?? [])].map((d) => d.trim().toLowerCase()).filter(Boolean).sort(),
    language: preferences?.language?.trim().toLowerCase() ?? "",
  };
  const hash = createHash("sha1").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
  return `${post.url.trim()}#${hash}`;
}
