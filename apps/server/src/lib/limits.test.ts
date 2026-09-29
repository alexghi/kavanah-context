import { describe, expect, it } from "vitest";
import { ConcurrencyGate, SlidingWindowLimiter } from "./limits.js";

describe("SlidingWindowLimiter", () => {
  it("allows `limit` hits per window per id, then refuses with a retry hint", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter(2, 60_000, () => now);
    expect(limiter.take("a")).toEqual({ allowed: true, remaining: 1 });
    now += 10_000;
    expect(limiter.take("a")).toEqual({ allowed: true, remaining: 0 });
    const refused = limiter.take("a");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterMs).toBe(50_000); // until the first hit leaves the window
    expect(limiter.take("b").allowed).toBe(true); // independent ids
    now += 30_000;
    expect(limiter.take("a").allowed).toBe(false);
    now += 20_001; // 60 001 ms after the first hit: it has expired, the second has not
    expect(limiter.take("a")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.count("a")).toBe(2);
  });

  it("is disabled with limit 0", () => {
    const limiter = new SlidingWindowLimiter(0);
    for (let i = 0; i < 100; i += 1) expect(limiter.take("x").allowed).toBe(true);
  });
});

describe("ConcurrencyGate", () => {
  it("hands out at most `max` slots and tolerates double release", () => {
    const gate = new ConcurrencyGate(2);
    const r1 = gate.tryAcquire();
    const r2 = gate.tryAcquire();
    expect(r1 && r2).toBeTruthy();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight).toBe(2);
    r1!();
    r1!();
    expect(gate.inFlight).toBe(1);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    r2!();
    expect(gate.inFlight).toBe(1);
  });

  it("is disabled with max 0", () => {
    const gate = new ConcurrencyGate(0);
    for (let i = 0; i < 10; i += 1) expect(gate.tryAcquire()).not.toBeNull();
  });
});
