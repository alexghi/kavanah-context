import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import { extractCandidateSources } from "../sources/candidates.js";
import {
  fail,
  ok,
  type Effort,
  type ModelProvider,
  type ModelResult,
  type SearchOutcome,
  type SearchRequest,
  type StructuredRequest,
  type TokenUsage,
} from "./provider.js";

/** The slice of the SDK client we use; injectable so tests can pass a fake. */
export interface AnthropicClientLike {
  messages: {
    create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>;
  };
}

export interface AnthropicProviderOptions {
  model: string;
  effort: Effort;
  webSearch: boolean;
  client?: AnthropicClientLike;
  log?: Logger;
}

export const DEFAULT_STAGE_MAX_TOKENS = 6000;
export const DEFAULT_SEARCH_MAX_TOKENS = 8000;
export const DEFAULT_SEARCH_MAX_USES = 6;
export const MAX_PAUSE_TURN_RESUMES = 2;

/** Haiku 4.5 (and older models) reject `output_config.effort`. */
export function supportsEffort(model: string): boolean {
  return !/haiku|claude-3|sonnet-4-5|opus-4-5|sonnet-4-\d{8}|opus-4-\d{8}/.test(model);
}

/** Haiku 4.5 (and older models) only run the basic web search tool; newer models take the filtering variant. */
export function webSearchToolType(model: string): "web_search_20250305" | "web_search_20260209" {
  return supportsEffort(model) ? "web_search_20260209" : "web_search_20250305";
}

export function createAnthropicClient(): AnthropicClientLike {
  // Reads ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL from the environment.
  return new Anthropic({ maxRetries: 1, timeout: 120_000 });
}

/** Maps SDK exceptions (most specific first) to the small stage-failure vocabulary. */
export function mapAnthropicError(err: unknown): ModelResult<never> {
  if (err instanceof Anthropic.AuthenticationError) {
    return fail("auth", "Anthropic API authentication failed (check ANTHROPIC_API_KEY)");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return fail("rate_limited", "Anthropic API rate limit reached; try again shortly", true);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return fail("timeout", "the request to the Anthropic API timed out", true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return fail("api_error", `could not reach the Anthropic API: ${err.message}`, true);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return fail("rate_limited", "the Anthropic API is overloaded; try again shortly", true);
    const retryable = typeof err.status === "number" && err.status >= 500;
    return fail("api_error", `Anthropic API error${err.status ? ` ${err.status}` : ""}: ${err.message}`, retryable);
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Thrown by the structured-output parser for malformed / off-schema output.
    return fail("invalid_output", err.message);
  }
  return fail("api_error", err instanceof Error ? err.message : String(err));
}

function usageOf(message: Anthropic.Messages.Message): TokenUsage {
  return { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 };
}

function textOf(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function refusalMessage(message: Anthropic.Messages.Message): string {
  const details = message.stop_details;
  const explanation = details && "explanation" in details && typeof details.explanation === "string" ? details.explanation : "";
  return explanation ? `the model declined: ${explanation}` : "the model declined to analyze this content";
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly webSearchAvailable: boolean;
  private readonly effort: Effort;
  private readonly client: AnthropicClientLike;
  private readonly log: Logger;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.webSearchAvailable = options.webSearch;
    this.client = options.client ?? createAnthropicClient();
    this.log = options.log ?? silentLogger;
  }

  /**
   * Structured stage. Uses `zodOutputFormat` (the SDK helper) for the schema and its
   * `parse` for validation, but calls `messages.create` rather than `messages.parse`
   * so `stop_reason` (refusal / max_tokens) can be checked BEFORE parsing: the SDK's
   * parse() throws on non-JSON text, which would hide a refusal.
   */
  async structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>> {
    const format = zodOutputFormat(request.schema);
    const effort = request.effort ?? this.effort;
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_STAGE_MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: supportsEffort(this.model) ? { format, effort } : { format },
      });
    } catch (err) {
      const mapped = mapAnthropicError(err);
      this.log.warn(`stage ${request.stage}: ${mapped.ok ? "" : mapped.reason} ${mapped.ok ? "" : mapped.message}`);
      return mapped;
    }

    if (response.stop_reason === "refusal") return fail("refusal", refusalMessage(response));
    if (response.stop_reason === "max_tokens") return fail("invalid_output", "the model's output was truncated (max_tokens)");

    const text = textOf(response);
    if (!text.trim()) return fail("invalid_output", "the model returned no text output");
    try {
      const value = format.parse(text);
      return ok(value, usageOf(response));
    } catch (err) {
      return fail("invalid_output", err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Evidence retrieval with the server-side web_search tool. Not combined with
   * structured output. Resumes `pause_turn` at most MAX_PAUSE_TURN_RESUMES times by
   * re-sending the conversation with the assistant content appended.
   */
  async search(request: SearchRequest): Promise<ModelResult<SearchOutcome>> {
    if (!this.webSearchAvailable) return fail("api_error", "web search is disabled (KAVANNAH_WEB_SEARCH=0)");

    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: request.user }];
    const collected: Anthropic.Messages.ContentBlock[] = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let resumed = 0;
    let last: Anthropic.Messages.Message;

    for (;;) {
      try {
        last = await this.client.messages.create({
          model: this.model,
          max_tokens: request.maxTokens ?? DEFAULT_SEARCH_MAX_TOKENS,
          system: request.system,
          messages: [...messages], // fresh array per call: the resume loop appends to `messages`
          tools: [{ type: webSearchToolType(this.model), name: "web_search", max_uses: request.maxUses ?? DEFAULT_SEARCH_MAX_USES }],
          ...(supportsEffort(this.model) ? { output_config: { effort: request.effort ?? this.effort } } : {}),
        });
      } catch (err) {
        return mapAnthropicError(err);
      }
      collected.push(...last.content);
      const u = usageOf(last);
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;

      if (last.stop_reason === "pause_turn" && resumed < MAX_PAUSE_TURN_RESUMES) {
        messages.push({ role: "assistant", content: last.content });
        resumed += 1;
        continue;
      }
      break;
    }

    if (last.stop_reason === "refusal") return fail("refusal", refusalMessage(last));

    const extracted = extractCandidateSources(collected);
    return ok(
      {
        candidates: extracted.candidates,
        notes: extracted.notes,
        searches: extracted.searches,
        queries: extracted.queries,
        toolErrors: extracted.toolErrors,
        resumed,
      },
      usage,
    );
  }
}
