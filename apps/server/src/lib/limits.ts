/**
 * In-memory guards for a hosted server (single process, hackathon scale):
 * a sliding-window rate limit per caller and a cap on concurrent live analyses.
 * Both only apply to work that calls the model; cache hits and mock answers are free.
 */

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type LimiterVerdict = { allowed: true; remaining: number } | { allowed: false; retryAfterMs: number };

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  /** `limit` 0 disables the limiter. */
  constructor(
    readonly limit: number,
    readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit for `id` when allowed. */
  take(id: string): LimiterVerdict {
    if (this.limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY };
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.hits.get(id) ?? []).filter((stamp) => stamp > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(id, recent);
      return { allowed: false, retryAfterMs: Math.max(1, recent[0]! + this.windowMs - t) };
    }
    recent.push(t);
    this.hits.set(id, recent);
    if (this.hits.size > 5000) this.prune(cutoff);
    return { allowed: true, remaining: this.limit - recent.length };
  }

  /** Hits inside the window for `id` (tests, diagnostics). */
  count(id: string): number {
    const cutoff = this.now() - this.windowMs;
    return (this.hits.get(id) ?? []).filter((stamp) => stamp > cutoff).length;
  }

  private prune(cutoff: number): void {
    for (const [id, stamps] of this.hits) {
      const recent = stamps.filter((stamp) => stamp > cutoff);
      if (recent.length === 0) this.hits.delete(id);
      else this.hits.set(id, recent);
    }
  }
}

export class ConcurrencyGate {
  private active = 0;

  /** `max` 0 disables the gate. */
  constructor(readonly max: number) {}

  /** Returns a release function, or null when the gate is full. Releasing twice is harmless. */
  tryAcquire(): (() => void) | null {
    if (this.max > 0 && this.active >= this.max) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
    };
  }

  get inFlight(): number {
    return this.active;
  }
}
