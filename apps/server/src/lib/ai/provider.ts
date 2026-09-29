import type { z } from "zod";

/**
 * Provider abstraction. Everything model-specific (Anthropic today) lives behind
 * this interface so the pipeline can be tested with a fake and the model swapped.
 */

export type StageFailureReason = "refusal" | "invalid_output" | "rate_limited" | "auth" | "api_error" | "timeout";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ModelResult<T> =
  | { ok: true; value: T; usage?: TokenUsage }
  | { ok: false; reason: StageFailureReason; message: string };

export function ok<T>(value: T, usage?: TokenUsage): ModelResult<T> {
  return usage ? { ok: true, value, usage } : { ok: true, value };
}

export function fail(reason: StageFailureReason, message: string): ModelResult<never> {
  return { ok: false, reason, message };
}

/** A structured-output call: system prompt + one user message → object matching `schema`. */
export interface StructuredRequest<T> {
  /** Stage name, for logging only. */
  stage: string;
  system: string;
  user: string;
  /** Keep simple: objects, strings, enums, booleans, numbers, arrays, optional fields. */
  schema: z.ZodType<T>;
  maxTokens?: number;
}

/** A source candidate that really came back from the provider's web search. */
export interface CandidateSource {
  /** Stable id used by later stages ("s1", "s2", ...). */
  id: string;
  url: string;
  title: string;
  /** Hostname without "www." */
  publisher: string;
  pageAge?: string;
  /** Text actually cited by the model from this result (never invented). */
  snippet?: string;
}

/** A web-search-backed research call. */
export interface SearchRequest {
  stage: string;
  system: string;
  user: string;
  maxUses?: number;
  maxTokens?: number;
}

export interface SearchOutcome {
  candidates: CandidateSource[];
  /** The model's own research notes (its text output). Context for the next stage, never a source. */
  notes: string;
  searches: number;
  queries: string[];
  toolErrors: string[];
  /** How many times a pause_turn was resumed. */
  resumed: number;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  readonly webSearchAvailable: boolean;
  structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>>;
  search(request: SearchRequest): Promise<ModelResult<SearchOutcome>>;
}

/** Human-readable description of a failure, for rationales and warnings. */
export function describeFailure(result: { reason: StageFailureReason; message: string }): string {
  switch (result.reason) {
    case "refusal":
      return "the model declined to analyze this content";
    case "invalid_output":
      return "the model returned invalid output";
    case "rate_limited":
      return "the API rate limit was reached";
    case "auth":
      return "API authentication failed";
    case "timeout":
      return "the request timed out";
    case "api_error":
      return "an API error occurred";
  }
}
