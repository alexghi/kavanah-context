import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ExtensionMessage, type Settings } from "@kavannah/shared";
import {
  createRouter,
  isBackgroundMessage,
  isExtensionMessage,
  joinUrl,
  networkErrorMessage,
  requestHeaders,
  resolveAnalyzeOptions,
  type RouterDeps,
} from "@/lib/background/router";
import { makeAnalysis, makeDraft, samplePost } from "./helpers/analysis";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function harness(settings: Partial<Settings> = {}, fetchImpl?: RouterDeps["fetch"]) {
  let current: Settings = { ...DEFAULT_SETTINGS, ...settings };
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (fetchImpl) return fetchImpl(input, init);
    return jsonResponse(200, makeAnalysis());
  });
  const openOptionsPage = vi.fn(async () => {});
  const router = createRouter({
    fetch: fetch as unknown as RouterDeps["fetch"],
    getSettings: async () => current,
    setSettings: async (patch) => {
      current = { ...current, ...patch };
      return current;
    },
    openOptionsPage,
    timeoutMs: 5000,
  });
  return { router, calls, fetch, openOptionsPage, settings: () => current };
}

const analyzeMessage: ExtensionMessage = { type: "kavannah:analyze", payload: { post: samplePost } };

describe("background router", () => {
  it("POSTs to /api/analyze and returns the validated analysis", async () => {
    const h = harness();
    const res = await h.router.handle(analyzeMessage);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(makeAnalysis());
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe("http://127.0.0.1:8787/api/analyze");
    expect(h.calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(h.calls[0]!.init?.body));
    expect(body.post).toEqual(samplePost);
    expect(body.options).toBeUndefined();
    expect(h.router.inFlight).toBe(0);
  });

  it("merges settings into the request options (demo mode, trusted domains, language)", async () => {
    const h = harness({ mockMode: true, trustedDomains: ["lemonde.fr"], language: "fr" });
    await h.router.handle({ type: "kavannah:analyze", payload: { post: samplePost, options: { refresh: true } } });
    const body = JSON.parse(String(h.calls[0]!.init?.body));
    expect(body.options).toEqual({ mock: true, refresh: true, preferences: { trustedDomains: ["lemonde.fr"], language: "fr" } });
  });

  it("explains a network failure with the server URL", async () => {
    const h = harness({ backendUrl: "http://localhost:9999/" }, async () => {
      throw new TypeError("fetch failed");
    });
    const res = await h.router.handle(analyzeMessage);
    expect(res).toEqual({ ok: false, error: { code: "NETWORK", message: networkErrorMessage("http://localhost:9999/") } });
    expect(networkErrorMessage("http://127.0.0.1:8787")).toBe(
      "Can't reach the Kavannah server at http://127.0.0.1:8787. Check the Backend URL in Settings; for a local server, start it with `npm run dev`.",
    );
    expect(h.calls[0]!.url).toBe("http://localhost:9999/api/analyze");
  });

  it("sends the access key as a bearer token when one is configured", async () => {
    const open = harness();
    await open.router.handle({ type: "kavannah:health" });
    const openHeaders = open.calls[0]!.init?.headers as Record<string, string>;
    expect(openHeaders.authorization).toBeUndefined();
    expect(openHeaders["content-type"]).toBeUndefined();
    expect(openHeaders.accept).toBe("application/json");

    const keyed = harness({ accessKey: "  kv_secretsecretsecret  " });
    await keyed.router.handle(analyzeMessage);
    const keyedHeaders = keyed.calls[0]!.init?.headers as Record<string, string>;
    expect(keyedHeaders.authorization).toBe("Bearer kv_secretsecretsecret");
    expect(keyedHeaders["content-type"]).toBe("application/json");
    expect(requestHeaders({ ...DEFAULT_SETTINGS, accessKey: "" }, false).authorization).toBeUndefined();
  });

  it("passes a 401 from a hosted server through with its message", async () => {
    const h = harness({}, async () => jsonResponse(401, { error: { code: "unauthorized", message: "This Kavannah server requires an access key." } }));
    const res = await h.router.handle(analyzeMessage);
    expect(res).toEqual({ ok: false, error: { code: "unauthorized", message: "This Kavannah server requires an access key." } });
  });

  it("reports timeouts separately", async () => {
    const h = harness({}, async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await h.router.handle(analyzeMessage);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TIMEOUT");
  });

  it("passes backend API errors through", async () => {
    const h = harness({}, async () => jsonResponse(400, { error: { code: "INVALID_POST", message: "Post text is required." } }));
    const res = await h.router.handle(analyzeMessage);
    expect(res).toEqual({ ok: false, error: { code: "INVALID_POST", message: "Post text is required." } });
  });

  it("labels non-conforming HTTP errors and non-JSON bodies", async () => {
    const h1 = harness({}, async () => jsonResponse(502, "<html>Bad gateway</html>", "Bad Gateway"));
    const r1 = await h1.router.handle({ type: "kavannah:health" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("BAD_RESPONSE");

    const h2 = harness({}, async () => jsonResponse(500, { message: "boom" }, "Internal Server Error"));
    const r2 = await h2.router.handle({ type: "kavannah:health" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("HTTP_500");
  });

  it("rejects responses that don't match the shared schema", async () => {
    const h = harness({}, async () => jsonResponse(200, { ...makeAnalysis(), classification: { headline: "x" } }));
    const res = await h.router.handle(analyzeMessage);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INVALID_RESPONSE");
      expect(res.error.message).toContain("classification");
    }
  });

  it("handles draft, health and fixtures", async () => {
    const draft = makeDraft("reply", "Here is some context.");
    const h = harness({}, async (input) => {
      const url = String(input);
      if (url.endsWith("/api/draft")) return jsonResponse(200, draft);
      if (url.endsWith("/api/health")) return jsonResponse(200, { ok: true, mode: "mock", model: "mock", webSearch: false, version: "0.1.0" });
      if (url.endsWith("/api/fixtures")) return jsonResponse(200, { fixtures: [{ id: "fx-1", title: "Demo", scenario: "misleading", post: samplePost }] });
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "nope" } });
    });
    const d = await h.router.handle({ type: "kavannah:draft", payload: { post: samplePost, analysis: makeAnalysis(), kind: "reply" } });
    expect(d).toEqual({ ok: true, data: draft });
    expect(h.calls[0]!.init?.method).toBe("POST");
    const health = await h.router.handle({ type: "kavannah:health" });
    expect(health.ok).toBe(true);
    expect(h.calls[1]!.init?.method).toBe("GET");
    const fixtures = await h.router.handle({ type: "kavannah:fixtures" });
    expect(fixtures.ok).toBe(true);
    if (fixtures.ok) expect((fixtures.data as { fixtures: unknown[] }).fixtures).toHaveLength(1);
  });

  it("reads and writes settings and opens the options page", async () => {
    const h = harness();
    expect(await h.router.handle({ type: "kavannah:getSettings" })).toEqual({ ok: true, data: DEFAULT_SETTINGS });
    const updated = await h.router.handle({ type: "kavannah:setSettings", payload: { mockMode: true } });
    expect(updated).toEqual({ ok: true, data: { ...DEFAULT_SETTINGS, mockMode: true } });
    expect(await h.router.handle({ type: "kavannah:openOptions" })).toEqual({ ok: true, data: null });
    expect(h.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("does not answer content-script messages", async () => {
    const h = harness();
    expect(isBackgroundMessage({ type: "kavannah:getCurrentPost" })).toBe(false);
    expect(isBackgroundMessage({ type: "kavannah:analyze", payload: { post: samplePost } })).toBe(true);
    expect(isExtensionMessage({ type: "other:thing" })).toBe(false);
    expect(isExtensionMessage(null)).toBe(false);
    const res = await h.router.handle({ type: "kavannah:getCurrentPost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNKNOWN_MESSAGE");
  });

  it("helpers: joinUrl and resolveAnalyzeOptions", () => {
    expect(joinUrl("http://127.0.0.1:8787/", "/api/analyze")).toBe("http://127.0.0.1:8787/api/analyze");
    expect(joinUrl("http://127.0.0.1:8787", "api/analyze")).toBe("http://127.0.0.1:8787/api/analyze");
    expect(resolveAnalyzeOptions(DEFAULT_SETTINGS)).toBeUndefined();
    expect(resolveAnalyzeOptions({ ...DEFAULT_SETTINGS, mockMode: true })).toEqual({ mock: true });
    expect(resolveAnalyzeOptions(DEFAULT_SETTINGS, { mock: true, preferences: { language: "de" } })).toEqual({
      mock: true,
      preferences: { language: "de" },
    });
  });
});
