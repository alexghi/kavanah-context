import { z } from "zod";
import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import { normalizeUrl, publisherFromUrl } from "../sources/candidates.js";
import {
  fail,
  ok,
  type CandidateSource,
  type ModelProvider,
  type ModelResult,
  type SearchOutcome,
  type SearchRequest,
  type StructuredRequest,
  type TokenUsage,
} from "./provider.js";

/**
 * OpenRouter provider (OpenAI-compatible chat completions over HTTPS, no SDK).
 *
 * Used in two ways:
 * - failover: when the Anthropic API rate-limits, overloads or times out, the same stage is
 *   retried here on the equivalent Claude model (`anthropic/claude-opus-5.5`, …);
 * - directly: a stage whose model id contains "/" (e.g. `google/gemini-3.5-flash-lite`) runs
 *   here; searches use OpenRouter's web plugin, and candidate sources come only from its
 *   url_citation annotations.
 */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_TIMEOUT_MS = 120_000;
export const DEFAULT_SEARCH_RESULTS = 8;

export type OpenRouterEngine = "native" | "exa";

export interface OpenRouterProviderOptions {
  apiKey: string;
  model: string;
  webSearch: boolean;
  /** Web plugin engine: native (the model's own search, when it has one) or exa. Default: let OpenRouter choose. */
  searchEngine?: OpenRouterEngine;
  log?: Logger;
  fetchImpl?: typeof fetch;
  /** Attribution headers OpenRouter shows in its dashboard. */
  referer?: string;
  title?: string;
}

/** `claude-opus-5-5` → `anthropic/claude-opus-5.5`; `claude-haiku-4-5-20251001` → `anthropic/claude-haiku-4.5`. */
export function openRouterModelFor(anthropicModel: string): string {
  if (anthropicModel.includes("/")) return anthropicModel;
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(anthropicModel.trim());
  if (m) return `anthropic/claude-${m[1]}-${m[2]}.${m[3]}`;
  const single = /^claude-([a-z]+)-(\d+)(?:-\d{8})?$/.exec(anthropicModel.trim());
  if (single) return `anthropic/claude-${single[1]}-${single[2]}`;
  return `anthropic/${anthropicModel}`;
}

/** True for model ids that name an OpenRouter route ("vendor/model"). */
export function isOpenRouterModel(model: string): boolean {
  return model.includes("/");
}

type JsonSchema = Record<string, unknown>;

/**
 * Zod → JSON Schema suitable for strict structured outputs: every object forbids extra keys and
 * requires all of its properties (our model-output schemas have no optional fields).
 */
export function strictJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema) as JsonSchema;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as JsonSchema;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties as JsonSchema);
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(raw);
  delete raw.$schema;
  return raw;
}

/** Drops tracking parameters some search engines append to cited URLs. */
export function cleanCitationUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === "source" || key === "ref_src") u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      refusal?: string | null;
      annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; server_tool_use_details?: { web_search_requests?: number } };
  error?: { code?: number | string; message?: string };
}

function usageOf(body: ChatCompletion): TokenUsage {
  return { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
}

/** Candidate sources from url_citation annotations: only what the search returned, deduped by URL. */
export function candidatesFromAnnotations(annotations: NonNullable<NonNullable<ChatCompletion["choices"]>[number]["message"]>["annotations"], max = 12): CandidateSource[] {
  const byKey = new Map<string, CandidateSource>();
  for (const annotation of annotations ?? []) {
    const cite = annotation?.url_citation;
    if (!cite?.url || annotation?.type !== "url_citation") continue;
    const url = cleanCitationUrl(cite.url);
    if (!/^https?:\/\//.test(url)) continue;
    const key = normalizeUrl(url);
    const existing = byKey.get(key);
    const snippet = cite.content?.replace(/\s+/g, " ").trim();
    if (existing) {
      if (snippet && !existing.snippet) existing.snippet = snippet.slice(0, 600);
      continue;
    }
    if (byKey.size >= max) continue;
    const candidate: CandidateSource = {
      id: `s${byKey.size + 1}`,
      url,
      title: cite.title?.trim() || publisherFromUrl(url) || url,
      publisher: publisherFromUrl(url),
    };
    if (snippet) candidate.snippet = snippet.slice(0, 600);
    byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  readonly model: string;
  readonly webSearchAvailable: boolean;
  private readonly apiKey: string;
  private readonly searchEngine: OpenRouterEngine | undefined;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly referer: string;
  private readonly title: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.webSearchAvailable = options.webSearch;
    this.searchEngine = options.searchEngine;
    this.log = options.log ?? silentLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.referer = options.referer ?? "https://github.com/alexghi/kavanah-context";
    this.title = options.title ?? "Kavannah";
  }

  private async complete(stage: string, body: Record<string, unknown>): Promise<ModelResult<ChatCompletion>> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": this.referer,
          "X-Title": this.title,
        },
        body: JSON.stringify({ model: this.model, ...body }),
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") return fail("timeout", `the request to OpenRouter (${stage}) timed out`, true);
      return fail("api_error", `could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    let parsed: ChatCompletion;
    try {
      parsed = (await response.json()) as ChatCompletion;
    } catch {
      return fail("api_error", `OpenRouter answered HTTP ${response.status} with a non-JSON body`, response.status >= 500);
    }
    const status = response.status;
    const errorCode = parsed.error ? Number(parsed.error.code) || status : 0;
    if (!response.ok || parsed.error) {
      const code = errorCode || status;
      const message = parsed.error?.message ?? `HTTP ${status}`;
      if (code === 401 || code === 403) return fail("auth", `OpenRouter authentication failed: ${message}`);
      if (code === 429) return fail("rate_limited", `OpenRouter rate limit reached: ${message}`, true);
      if (code === 402) return fail("api_error", `OpenRouter credits exhausted: ${message}`);
      if (code === 408 || code === 504) return fail("timeout", `OpenRouter: ${message}`, true);
      return fail("api_error", `OpenRouter error ${code}: ${message}`, code >= 500);
    }
    return ok(parsed);
  }

  async structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>> {
    const result = await this.complete(request.stage, {
      max_tokens: request.maxTokens ?? 6000,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: request.stage.replace(/[^a-zA-Z0-9_-]/g, "_"), strict: true, schema: strictJsonSchema(request.schema) },
      },
      provider: { require_parameters: true },
    });
    if (!result.ok) {
      this.log.warn(`stage ${request.stage} (openrouter ${this.model}): ${result.reason} ${result.message}`);
      return result;
    }
    const choice = result.value.choices?.[0];
    if (choice?.message?.refusal) return fail("refusal", `the model declined: ${choice.message.refusal}`);
    if (choice?.finish_reason === "content_filter") return fail("refusal", "the model declined to analyze this content");
    if (choice?.finish_reason === "length") return fail("invalid_output", "the model's output was truncated (max_tokens)");
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (!text.trim()) return fail("invalid_output", "the model returned no text output");
    try {
      return ok(request.schema.parse(JSON.parse(text)), usageOf(result.value));
    } catch (err) {
      return fail("invalid_output", err instanceof Error ? err.message : String(err));
    }
  }

  async search(request: SearchRequest): Promise<ModelResult<SearchOutcome>> {
    if (!this.webSearchAvailable) return fail("api_error", "web search is disabled (KAVANNAH_WEB_SEARCH=0)");
    const plugin: Record<string, unknown> = { id: "web", max_results: Math.min(Math.max(request.maxUses ?? 2, 1) * 4, DEFAULT_SEARCH_RESULTS) };
    if (this.searchEngine) plugin.engine = this.searchEngine;
    const result = await this.complete(request.stage, {
      max_tokens: request.maxTokens ?? 3000,
      plugins: [plugin],
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });
    if (!result.ok) return result;
    const choice = result.value.choices?.[0];
    if (choice?.finish_reason === "content_filter") return fail("refusal", "the model declined to analyze this content");
    const notes = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const candidates = candidatesFromAnnotations(choice?.message?.annotations);
    return ok(
      {
        candidates,
        notes,
        searches: result.value.usage?.server_tool_use_details?.web_search_requests ?? (candidates.length ? 1 : 0),
        queries: [],
        toolErrors: [],
        resumed: 0,
      },
      usageOf(result.value),
    );
  }
}
