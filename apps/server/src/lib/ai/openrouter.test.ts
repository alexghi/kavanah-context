import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { candidatesFromAnnotations, cleanCitationUrl, isOpenRouterModel, OpenRouterProvider, openRouterModelFor, strictJsonSchema } from "./openrouter.js";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift() ?? { status: 500, body: { error: { message: "no more responses" } } };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const completion = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  model: "anthropic/claude-haiku-4.5",
  choices: [{ finish_reason: "stop", message }],
  usage: { prompt_tokens: 12, completion_tokens: 7, ...extra },
});

describe("OpenRouter helpers", () => {
  it("maps Anthropic model ids to OpenRouter routes", () => {
    expect(openRouterModelFor("claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
    expect(openRouterModelFor("claude-haiku-4-5-20251001")).toBe("anthropic/claude-haiku-4.5");
    expect(openRouterModelFor("claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5.5");
    expect(openRouterModelFor("claude-opus-5")).toBe("anthropic/claude-opus-5");
    expect(openRouterModelFor("google/gemini-3.5-flash-lite")).toBe("google/gemini-3.5-flash-lite");
    expect(isOpenRouterModel("openai/gpt-5.4-mini")).toBe(true);
    expect(isOpenRouterModel("claude-opus-5-5")).toBe(false);
  });

  it("produces a strict JSON schema (no extra keys, everything required)", () => {
    const schema = z.object({ a: z.string(), items: z.array(z.object({ kind: z.enum(["x", "y"]), n: z.number() })) });
    const json = strictJsonSchema(schema) as { additionalProperties?: boolean; required?: string[]; properties: { items: { items: { additionalProperties?: boolean; required?: string[] } } }; $schema?: string };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(["a", "items"]);
    expect(json.properties.items.items.additionalProperties).toBe(false);
    expect(json.properties.items.items.required).toEqual(["kind", "n"]);
    expect(json.$schema).toBeUndefined();
  });

  it("turns url_citation annotations into deduped candidates and strips tracking parameters", () => {
    expect(cleanCitationUrl("https://www.federalreserve.gov/faqs/about_14986.htm?source=news_body_link&utm_source=openai")).toBe("https://www.federalreserve.gov/faqs/about_14986.htm");
    expect(cleanCitationUrl("https://example.org/a?page=2&utm_medium=x")).toBe("https://example.org/a?page=2");
    const candidates = candidatesFromAnnotations([
      { type: "url_citation", url_citation: { url: "https://www.federalreserve.gov/faqs/about_14986.htm?utm_source=openai", title: "Who owns the Fed?", content: "The Federal Reserve System is not owned by anyone." } },
      { type: "url_citation", url_citation: { url: "https://www.federalreserve.gov/faqs/about_14986.htm", title: "dup" } },
      { type: "url_citation", url_citation: { url: "ftp://nope", title: "bad" } },
      { type: "other", url_citation: { url: "https://ignored.example", title: "x" } },
      { type: "url_citation", url_citation: { url: "https://www.ajc.org/translatehate/rothschild" } },
    ]);
    expect(candidates).toEqual([
      { id: "s1", url: "https://www.federalreserve.gov/faqs/about_14986.htm", title: "Who owns the Fed?", publisher: "federalreserve.gov", snippet: "The Federal Reserve System is not owned by anyone." },
      { id: "s2", url: "https://www.ajc.org/translatehate/rothschild", title: "ajc.org", publisher: "ajc.org" },
    ]);
  });
});

describe("OpenRouterProvider", () => {
  const schema = z.object({ answer: z.string(), n: z.number() });

  it("requests strict json_schema output and parses the JSON content", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: completion({ content: '{"answer":"yes","n":2}' }) }]);
    const provider = new OpenRouterProvider({ apiKey: "k", model: "anthropic/claude-haiku-4.5", webSearch: true, fetchImpl: impl });
    const result = await provider.structured({ stage: "draft:reply", system: "sys", user: "usr", schema, maxTokens: 500, effort: "low" });
    expect(result).toEqual({ ok: true, value: { answer: "yes", n: 2 }, usage: { inputTokens: 12, outputTokens: 7 } });
    const body = calls[0]!.body as { model: string; max_tokens: number; messages: unknown[]; response_format: { type: string; json_schema: { name: string; strict: boolean } }; provider: { require_parameters: boolean } };
    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(body.max_tokens).toBe(500);
    expect(body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "usr" }]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("draft_reply");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider.require_parameters).toBe(true);
  });

  it("maps errors: 429 and 5xx retryable, 401 auth, off-schema output invalid", async () => {
    const provider = (responses: Array<{ status: number; body: unknown }>) =>
      new OpenRouterProvider({ apiKey: "k", model: "anthropic/claude-opus-5.5", webSearch: true, fetchImpl: fakeFetch(responses).impl });
    const req = { stage: "classifyContent", system: "s", user: "u", schema };
    expect(await provider([{ status: 429, body: { error: { code: 429, message: "slow down" } } }]).structured(req)).toMatchObject({ ok: false, reason: "rate_limited", retryable: true });
    expect(await provider([{ status: 502, body: { error: { message: "bad gateway" } } }]).structured(req)).toMatchObject({ ok: false, reason: "api_error", retryable: true });
    expect(await provider([{ status: 401, body: { error: { message: "no" } } }]).structured(req)).toMatchObject({ ok: false, reason: "auth" });
    const bad = await provider([{ status: 200, body: { error: { code: 400, message: "bad request" } } }]).structured(req);
    expect(bad).toMatchObject({ ok: false, reason: "api_error" });
    expect(!bad.ok && bad.retryable).toBeFalsy();
    expect(await provider([{ status: 200, body: completion({ content: '{"answer":"yes"}' }) }]).structured(req)).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(await provider([{ status: 200, body: completion({ refusal: "cannot" }) }]).structured(req)).toMatchObject({ ok: false, reason: "refusal" });
  });

  it("searches with the web plugin and takes sources only from annotations", async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 200,
        body: completion(
          {
            content: "Notes: the Fed is not owned by anyone.",
            annotations: [{ type: "url_citation", url_citation: { url: "https://www.federalreserve.gov/faqs/about_14986.htm", title: "Who owns the Fed?", content: "not owned" } }],
          },
          { server_tool_use_details: { web_search_requests: 1 } },
        ),
      },
    ]);
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openai/gpt-5.4-mini", webSearch: true, searchEngine: "exa", fetchImpl: impl });
    const result = await provider.search({ stage: "retrieveEvidence", system: "s", user: "u", maxUses: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates.map((c) => c.url)).toEqual(["https://www.federalreserve.gov/faqs/about_14986.htm"]);
      expect(result.value.notes).toContain("not owned by anyone");
      expect(result.value.searches).toBe(1);
    }
    const body = calls[0]!.body as { plugins: Array<{ id: string; engine?: string; max_results: number }> };
    expect(body.plugins).toEqual([{ id: "web", max_results: 8, engine: "exa" }]);
    const off = new OpenRouterProvider({ apiKey: "k", model: "openai/gpt-5.4-mini", webSearch: false, fetchImpl: impl });
    expect((await off.search({ stage: "retrieveEvidence", system: "s", user: "u" })).ok).toBe(false);
  });
});
