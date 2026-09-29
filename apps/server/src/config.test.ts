import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, isLoopback, resolveConfig, startupBlocker } from "./config.js";

describe("resolveConfig", () => {
  it("falls back to mock mode without an API key and explains why", () => {
    const c = resolveConfig({});
    expect(c.mode).toBe("mock");
    expect(c.hasApiKey).toBe(false);
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.effort).toBe("medium");
    expect(c.port).toBe(8787);
    expect(c.host).toBe("127.0.0.1");
    expect(c.webSearchEnabled).toBe(true);
    expect(c.accessKeys).toEqual([]);
    expect(c.rateLimitPerHour).toBe(30);
    expect(c.maxConcurrent).toBe(4);
    expect(c.trustProxy).toBe(false);
    expect(c.notices.join(" ")).toContain("ANTHROPIC_API_KEY is not set");
  });

  it("is live with a key, mock when KAVANNAH_MOCK=1, and parses the other variables", () => {
    expect(resolveConfig({ ANTHROPIC_API_KEY: "sk-test" }).mode).toBe("live");
    const c = resolveConfig({ ANTHROPIC_API_KEY: "sk-test", KAVANNAH_MOCK: "1", KAVANNAH_MODEL: "claude-sonnet-5-5", KAVANNAH_EFFORT: "HIGH", KAVANNAH_PORT: "9999", KAVANNAH_WEB_SEARCH: "0" });
    expect(c).toMatchObject({ mode: "mock", mockForced: true, hasApiKey: true, model: "claude-sonnet-5-5", effort: "high", port: 9999, webSearchEnabled: false });
    expect(resolveConfig({ KAVANNAH_EFFORT: "max" }).effort).toBe("medium");
    expect(resolveConfig({ KAVANNAH_EFFORT: "max" }).notices.join(" ")).toContain("KAVANNAH_EFFORT");
    expect(resolveConfig({ KAVANNAH_PORT: "abc" }).port).toBe(8787);
  });

  it("honours PORT (hosting platforms) unless KAVANNAH_PORT is set", () => {
    expect(resolveConfig({ PORT: "8080" }).port).toBe(8080);
    expect(resolveConfig({ PORT: "8080", KAVANNAH_PORT: "9000" }).port).toBe(9000);
  });

  it("parses hosting settings: host, access keys, limits, proxy trust", () => {
    const c = resolveConfig({
      ANTHROPIC_API_KEY: "sk-test",
      KAVANNAH_HOST: "0.0.0.0",
      KAVANNAH_ACCESS_KEYS: "alex:kv_alexalexalexalex,judge:kv_judgejudgejudgejudge",
      KAVANNAH_RATE_LIMIT: "5",
      KAVANNAH_MAX_CONCURRENT: "0",
    });
    expect(c.host).toBe("0.0.0.0");
    expect(c.accessKeys.map((k) => k.name)).toEqual(["alex", "judge"]);
    expect(c.rateLimitPerHour).toBe(5);
    expect(c.maxConcurrent).toBe(0);
    expect(c.trustProxy).toBe(true); // default when not bound to loopback
    expect(resolveConfig({ KAVANNAH_HOST: "0.0.0.0", KAVANNAH_TRUST_PROXY: "0" }).trustProxy).toBe(false);
    expect(resolveConfig({ KAVANNAH_TRUST_PROXY: "1" }).trustProxy).toBe(true);
    const bad = resolveConfig({ KAVANNAH_RATE_LIMIT: "-3", KAVANNAH_MAX_CONCURRENT: "lots" });
    expect(bad.rateLimitPerHour).toBe(30);
    expect(bad.maxConcurrent).toBe(4);
    expect(bad.notices.filter((n) => n.includes("non-negative integer"))).toHaveLength(2);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
  });

  it("refuses to expose a live server without keys unless explicitly allowed", () => {
    const exposedLive = { ANTHROPIC_API_KEY: "sk-test", KAVANNAH_HOST: "0.0.0.0" };
    expect(startupBlocker(resolveConfig(exposedLive))).toContain("Refusing to start");
    expect(startupBlocker(resolveConfig({ ...exposedLive, KAVANNAH_ACCESS_KEYS: "a:kv_aaaaaaaaaaaaaaaa" }))).toBeNull();
    expect(startupBlocker(resolveConfig({ ...exposedLive, KAVANNAH_ALLOW_ANONYMOUS: "1" }))).toBeNull();
    expect(startupBlocker(resolveConfig({ KAVANNAH_HOST: "0.0.0.0" }))).toBeNull(); // mock mode spends nothing
    expect(startupBlocker(resolveConfig({ ANTHROPIC_API_KEY: "sk-test" }))).toBeNull(); // loopback
  });

  it("never exposes the key", () => {
    const c = resolveConfig({ ANTHROPIC_API_KEY: "sk-super-secret" });
    expect(JSON.stringify(c)).not.toContain("sk-super-secret");
  });
});
