import { z } from "zod";
import { describe, expect, it } from "vitest";
import { fail, ok, type ModelProvider, type ModelResult, type SearchOutcome, type SearchRequest, type StructuredRequest } from "./provider.js";
import { effortFor, roleFor, RoutingProvider } from "./router.js";

class StubProvider implements ModelProvider {
  readonly calls: Array<{ kind: "structured" | "search"; stage: string; effort?: string }> = [];
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly results: ModelResult<unknown>[] = [],
    readonly webSearchAvailable = true,
  ) {}
  private next(): ModelResult<unknown> {
    return this.results.length > 1 ? this.results.shift()! : (this.results[0] ?? ok({ answer: this.model }));
  }
  async structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>> {
    this.calls.push({ kind: "structured", stage: request.stage, effort: request.effort });
    return this.next() as ModelResult<T>;
  }
  async search(request: SearchRequest): Promise<ModelResult<SearchOutcome>> {
    this.calls.push({ kind: "search", stage: request.stage, effort: request.effort });
    return this.next() as ModelResult<SearchOutcome>;
  }
}

const schema = z.object({ answer: z.string() });
const req = (stage: string) => ({ stage, system: "s", user: "u", schema });

describe("stage routing", () => {
  it("maps stages to tiers and efforts", () => {
    expect(roleFor("extractClaims")).toBe("fast");
    expect(roleFor("retrieveEvidence")).toBe("search");
    expect(roleFor("researchIhra")).toBe("search");
    expect(roleFor("classifyContent")).toBe("judge");
    expect(roleFor("assessIhra")).toBe("judge");
    expect(roleFor("draft:reply")).toBe("judge");
    expect(roleFor("somethingNew")).toBe("judge");
    expect(effortFor("classifyContent", "medium")).toBe("medium");
    expect(effortFor("draft:community_note", "high")).toBe("high");
    expect(effortFor("recommendEngagement", "high")).toBe("low");
    expect(effortFor("extractClaims", "medium")).toBe("low");
  });

  it("sends each stage to its tier and falls back to the judge when a tier is missing", async () => {
    const judge = new StubProvider("anthropic", "opus");
    const fast = new StubProvider("anthropic", "haiku");
    const router = new RoutingProvider({ tiers: { judge, fast }, effort: "medium" });
    expect((await router.structured(req("extractClaims"))).ok).toBe(true);
    expect((await router.structured(req("classifyContent"))).ok).toBe(true);
    await router.search({ stage: "retrieveEvidence", system: "s", user: "u" });
    expect(fast.calls.map((c) => c.stage)).toEqual(["extractClaims", "retrieveEvidence"]);
    expect(judge.calls.map((c) => c.stage)).toEqual(["classifyContent"]);
    expect(fast.calls[0]?.effort).toBe("low");
    expect(judge.calls[0]?.effort).toBe("medium");
    expect(router.model).toBe("opus");
    expect(router.providerFor("assessEvidence")).toBe(judge);

    const judgeOnly = new RoutingProvider({ tiers: { judge: new StubProvider("anthropic", "opus") }, effort: "low" });
    expect(judgeOnly.providerFor("extractClaims").model).toBe("opus");
    expect(judgeOnly.providerFor("researchIhra").model).toBe("opus");
  });

  it("uses a dedicated search tier for research calls only", async () => {
    const judge = new StubProvider("anthropic", "opus");
    const fast = new StubProvider("anthropic", "haiku");
    const search = new StubProvider("openrouter", "openai/gpt-5.4-mini", [], false);
    const router = new RoutingProvider({ tiers: { judge, fast, search }, effort: "medium" });
    expect(router.providerFor("retrieveEvidence")).toBe(search);
    expect(router.providerFor("extractClaims")).toBe(fast);
    expect(router.webSearchAvailable).toBe(false);
    expect(router.describe().join("\n")).toContain("openai/gpt-5.4-mini (openrouter)");
  });

  it("retries retryable failures on the failover provider, once", async () => {
    const judge = new StubProvider("anthropic", "claude-opus-5-5", [fail("rate_limited", "429", true), ok({ answer: "second" })]);
    const alternate = new StubProvider("openrouter", "anthropic/claude-opus-5.5", [ok({ answer: "from openrouter" })]);
    const router = new RoutingProvider({ tiers: { judge }, effort: "medium", failoverFor: (p) => (p.name === "anthropic" ? alternate : null) });
    const result = await router.structured(req("classifyContent"));
    expect(result).toEqual({ ok: true, value: { answer: "from openrouter" } });
    expect(judge.calls).toHaveLength(1);
    expect(alternate.calls).toHaveLength(1);
    expect(alternate.calls[0]?.effort).toBe("medium");
    // Non-retryable failures are returned as they are.
    const strict = new StubProvider("anthropic", "opus", [fail("invalid_output", "bad json")]);
    const alt2 = new StubProvider("openrouter", "or");
    const router2 = new RoutingProvider({ tiers: { judge: strict }, effort: "medium", failoverFor: () => alt2 });
    expect(await router2.structured(req("classifyContent"))).toEqual({ ok: false, reason: "invalid_output", message: "bad json" });
    expect(alt2.calls).toHaveLength(0);
  });

  it("reports both failures when the failover fails too, and skips failover when none is configured", async () => {
    const judge = new StubProvider("anthropic", "opus", [fail("timeout", "slow", true)]);
    const alternate = new StubProvider("openrouter", "or", [fail("rate_limited", "busy", true)]);
    const router = new RoutingProvider({ tiers: { judge }, effort: "low", failoverFor: () => alternate });
    const result = await router.search({ stage: "retrieveEvidence", system: "s", user: "u" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
      expect(result.message).toContain("failover to openrouter also failed (rate_limited: busy)");
    }
    const lone = new StubProvider("anthropic", "opus", [fail("timeout", "slow", true)]);
    const router2 = new RoutingProvider({ tiers: { judge: lone }, effort: "low" });
    expect(await router2.structured(req("classifyContent"))).toEqual({ ok: false, reason: "timeout", message: "slow", retryable: true });
  });
});
