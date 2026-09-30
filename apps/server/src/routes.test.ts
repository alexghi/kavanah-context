import type { AddressInfo } from "node:net";
import type http from "node:http";
import { AnalyzePostResponseSchema, DraftResponseSchema, FixturesResponseSchema, HealthResponseSchema, type AnalyzePostResponse } from "@kavannah/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { ANALYSIS_CACHE_TTL_MS, TtlCache } from "./lib/cache.js";
import { ConcurrencyGate, SlidingWindowLimiter } from "./lib/limits.js";
import { silentLogger } from "./lib/log.js";
import { findFixture } from "./mock/fixtures.js";
import { MOCK_WARNING } from "./mock/mockProvider.js";
import { FakeProvider, TEST_POST, fakeValidateUrl } from "./test/fakeProvider.js";

function config(mode: "mock" | "live", overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    model: "fake-model",
    modelFast: "",
    searchModel: "",
    openRouterFailover: false,
    hasOpenRouterKey: false,
    effort: "medium",
    mockForced: mode === "mock",
    hasApiKey: mode === "live",
    webSearchEnabled: true,
    mode,
    version: "0.1.0-test",
    accessKeys: [],
    allowAnonymous: false,
    rateLimitPerHour: 0,
    maxConcurrent: 0,
    trustProxy: false,
    notices: [],
    ...overrides,
  };
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; base: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const key = findFixture("no-engage-note-recommended")!;

describe("HTTP API — mock mode", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await listen(createApp({ config: config("mock"), provider: null, cache: new TtlCache(ANALYSIS_CACHE_TTL_MS), log: silentLogger, mockDelayMs: [0, 0] })));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("GET /api/health", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toEqual({ ok: true, mode: "mock", model: "fake-model", webSearch: false, version: "0.1.0-test", auth: { required: false, key: "none" } });
  });

  it("GET /api/fixtures lists the 10 demo posts", async () => {
    const body = FixturesResponseSchema.parse(await (await fetch(`${base}/api/fixtures`)).json());
    expect(body.fixtures).toHaveLength(10);
    expect(body.fixtures.find((f) => f.id === key.id)?.post).toEqual(key.post);
  });

  it("POST /api/analyze answers from the fixture", async () => {
    const res = await fetch(`${base}/api/analyze`, json({ post: key.post }));
    expect(res.status).toBe(200);
    const body = AnalyzePostResponseSchema.parse(await res.json());
    expect(body.meta.mode).toBe("mock");
    expect(body.meta.fixtureId).toBe(key.id);
    expect(body.meta.warnings).toContain(MOCK_WARNING);
    expect(body.engagement.recommendation).toBe("do_not_engage");
    expect(body.communityNote.recommendation).toBe("recommended");
  });

  it("POST /api/draft returns the fixture draft", async () => {
    const analysis = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: key.post }))).json());
    const res = await fetch(`${base}/api/draft`, json({ post: key.post, analysis, kind: "community_note" }));
    expect(res.status).toBe(200);
    const body = DraftResponseSchema.parse(await res.json());
    expect(body.text).toBe(key.drafts.community_note);
    expect(body.sources).toHaveLength(2);
  });

  it("validation errors and unknown routes use the ApiError shape", async () => {
    const bad = await fetch(`${base}/api/analyze`, json({ post: { platform: "x", url: "" } }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; message: string; details?: unknown } };
    expect(body.error.code).toBe("invalid_request");
    expect(Array.isArray(body.error.details)).toBe(true);

    const notJson = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

    const badDraft = await fetch(`${base}/api/draft`, json({ post: key.post, kind: "reply" }));
    expect(badDraft.status).toBe(400);

    const missing = await fetch(`${base}/api/nope`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("HTTP API — live mode with a fake provider", () => {
  let server: http.Server;
  let base: string;
  let provider: FakeProvider;
  const cache = new TtlCache<AnalyzePostResponse>(ANALYSIS_CACHE_TTL_MS);

  beforeAll(async () => {
    provider = new FakeProvider({ structured: { classifyContent: [] } });
    ({ server, base } = await listen(createApp({ config: config("live"), provider, cache, log: silentLogger, mockDelayMs: [0, 0], validateUrl: fakeValidateUrl })));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("health reports live mode with web search on", async () => {
    expect(HealthResponseSchema.parse(await (await fetch(`${base}/api/health`)).json())).toMatchObject({ mode: "live", webSearch: true });
  });

  it("runs the pipeline, caches by URL + preferences, and honours refresh", async () => {
    const first = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: TEST_POST }))).json());
    expect(first.meta.mode).toBe("live");
    expect(first.meta.model).toBe("fake-model");
    const callsAfterFirst = provider.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: TEST_POST }))).json());
    expect(second.meta.analyzedAt).toBe(first.meta.analyzedAt); // cache hit
    expect(provider.calls.length).toBe(callsAfterFirst);

    await fetch(`${base}/api/analyze`, json({ post: TEST_POST, options: { preferences: { trustedDomains: ["example.org"] } } }));
    expect(provider.calls.length).toBeGreaterThan(callsAfterFirst); // different preferences → different key
    const afterPrefs = provider.calls.length;

    const refreshed = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: TEST_POST, options: { refresh: true } }))).json());
    expect(provider.calls.length).toBeGreaterThan(afterPrefs);
    expect(refreshed.meta.mode).toBe("live");
  });

  it("options.mock forces the fixture path even in live mode", async () => {
    const before = provider.calls.length;
    const body = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: key.post, options: { mock: true } }))).json());
    expect(body.meta.mode).toBe("mock");
    expect(provider.calls.length).toBe(before);
  });

  it("live draft goes through the provider and is sanitized", async () => {
    const analysis = AnalyzePostResponseSchema.parse(await (await fetch(`${base}/api/analyze`, json({ post: TEST_POST, options: { refresh: true } }))).json());
    const res = await fetch(`${base}/api/draft`, json({ post: TEST_POST, analysis, kind: "reply" }));
    expect(res.status).toBe(200);
    const body = DraftResponseSchema.parse(await res.json());
    expect(body.meta.mode).toBe("live");
    expect(body.text).toContain("https://example.org/moon");
    expect(body.sources.map((s) => s.id)).toEqual(["s1"]);
  });

  it("classification failing twice → 502 analysis_failed", async () => {
    const failing = new FakeProvider({ structured: { classifyContent: { ok: false, reason: "api_error", message: "upstream 500" } } });
    const { server: s2, base: b2 } = await listen(createApp({ config: config("live"), provider: failing, cache: new TtlCache(1000), log: silentLogger, validateUrl: fakeValidateUrl }));
    try {
      const res = await fetch(`${b2}/api/analyze`, json({ post: TEST_POST }));
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("analysis_failed");
      expect(body.error.message).toContain("an API error occurred");
    } finally {
      await new Promise<void>((resolve) => s2.close(() => resolve()));
    }
  });
});

describe("HTTP API — access keys and limits (hosted server)", () => {
  const ALEX = "kv_alexalexalexalexalexalex";
  const JUDGE = "kv_judgejudgejudgejudgejudge";
  const accessKeys = [
    { name: "alex", key: ALEX },
    { name: "judge", key: JUDGE },
  ];
  const withKey = (key: string, body?: unknown): RequestInit => ({
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  let server: http.Server;
  let base: string;
  let provider: FakeProvider;
  let gate: ConcurrencyGate;
  let limiter: SlidingWindowLimiter;

  beforeAll(async () => {
    provider = new FakeProvider({ structured: { classifyContent: [] } });
    gate = new ConcurrencyGate(1);
    limiter = new SlidingWindowLimiter(2, 60 * 60 * 1000);
    const app = createApp({
      config: config("live", { accessKeys, rateLimitPerHour: 2, maxConcurrent: 1 }),
      provider,
      cache: new TtlCache(ANALYSIS_CACHE_TTL_MS),
      log: silentLogger,
      mockDelayMs: [0, 0],
      validateUrl: fakeValidateUrl,
      limiter,
      gate,
    });
    ({ server, base } = await listen(app));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("health is open and reports the key status without leaking keys", async () => {
    const anonymous = HealthResponseSchema.parse(await (await fetch(`${base}/api/health`)).json());
    expect(anonymous.auth).toEqual({ required: true, key: "none" });
    const valid = HealthResponseSchema.parse(await (await fetch(`${base}/api/health`, withKey(JUDGE))).json());
    expect(valid.auth).toEqual({ required: true, key: "valid", name: "judge" });
    const invalid = await (await fetch(`${base}/api/health`, withKey("kv_nopenopenopenopenope"))).text();
    expect(HealthResponseSchema.parse(JSON.parse(invalid)).auth).toEqual({ required: true, key: "invalid" });
    expect(invalid).not.toContain(ALEX);
    expect(invalid).not.toContain(JUDGE);
  });

  it("fixtures stay open; analyze and draft require a valid key", async () => {
    expect((await fetch(`${base}/api/fixtures`)).status).toBe(200);

    const missing = await fetch(`${base}/api/analyze`, json({ post: TEST_POST }));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect(await errorCode(missing)).toBe("unauthorized");

    const wrong = await fetch(`${base}/api/analyze`, withKey("kv_wrongwrongwrongwrongwrong", { post: TEST_POST }));
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toContain("not accepted");

    const viaHeader = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "content-type": "application/json", "x-kavannah-key": ALEX }, body: JSON.stringify({ post: key.post, options: { mock: true } }) });
    expect(viaHeader.status).toBe(200);

    const draftMissing = await fetch(`${base}/api/draft`, json({ post: key.post, analysis: await viaHeader.json(), kind: "reply" }));
    expect(draftMissing.status).toBe(401);
  });

  it("rate-limits live work per key; cache hits and mock answers are free", async () => {
    const post = (n: number) => ({ ...TEST_POST, url: `https://x.com/limits/status/${n}` });
    expect((await fetch(`${base}/api/analyze`, withKey(ALEX, { post: post(1) }))).status).toBe(200);
    expect((await fetch(`${base}/api/analyze`, withKey(ALEX, { post: post(2) }))).status).toBe(200);
    const third = await fetch(`${base}/api/analyze`, withKey(ALEX, { post: post(3) }));
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await errorCode(third)).toBe("rate_limited");

    // Cached result for post 1: no model call, no rate-limit hit.
    const cached = await fetch(`${base}/api/analyze`, withKey(ALEX, { post: post(1) }));
    expect(cached.status).toBe(200);
    expect(limiter.count("key:alex")).toBe(2);
    // Mock answers are free too.
    expect((await fetch(`${base}/api/analyze`, withKey(ALEX, { post: key.post, options: { mock: true } }))).status).toBe(200);
    // Another person has their own budget.
    expect((await fetch(`${base}/api/analyze`, withKey(JUDGE, { post: post(3) }))).status).toBe(200);
    expect(gate.inFlight).toBe(0);
  });

  it("answers 503 busy when the concurrency cap is reached", async () => {
    const release = gate.tryAcquire();
    expect(release).not.toBeNull();
    try {
      const busy = await fetch(`${base}/api/analyze`, withKey(JUDGE, { post: { ...TEST_POST, url: "https://x.com/limits/status/9" } }));
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("30");
      expect(await errorCode(busy)).toBe("busy");
    } finally {
      release!();
    }
    expect(limiter.count("key:judge")).toBe(1); // the refused request did not count
  });
});
