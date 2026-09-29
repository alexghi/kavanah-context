import type { AnalyzePostResponse, DraftKind, DraftRequest, DraftResponse, Source } from "@kavannah/shared";
import { describeFailure, type ModelProvider, type StageFailureReason } from "../ai/provider.js";
import { silentLogger, type Logger } from "../log.js";
import { normalizeUrl } from "../sources/candidates.js";
import { draftPrompt } from "./prompts.js";
import { DraftOutputSchema } from "./schemas.js";

export class DraftFailedError extends Error {
  readonly code = "draft_failed" as const;
  constructor(
    message: string,
    readonly reason: StageFailureReason,
  ) {
    super(message);
    this.name = "DraftFailedError";
  }
}

export const NO_SOURCE_WARNING =
  "No verified source available — add a source before submitting; X rates notes without sources as unhelpful.";
export const REPLY_LENGTH_LIMIT = 280;

export const DRAFT_WARNINGS = {
  removedForeignUrl: "A URL that was not among the analysis sources was removed from the draft.",
  removedExtraUrl: (max: number) => `The draft cited more than ${max} source${max === 1 ? "" : "s"}; extra URLs were removed.`,
  removedMention: "An @mention was removed from the draft (replies should not tag accounts).",
  replyTooLong: `The reply is longer than ${REPLY_LENGTH_LIMIT} characters; shorten it before posting.`,
  unverifiedSource: "The cited source could not be verified by the backend; open it before submitting.",
  noteWithoutSource: NO_SOURCE_WARNING,
} as const;

const URL_RE = /https?:\/\/[^\s<>()"'\]]+/g;

/** All sources referenced by the analysis, deduped by id (verified first). */
export function collectAnalysisSources(analysis: AnalyzePostResponse): Source[] {
  const byId = new Map<string, Source>();
  for (const item of analysis.evidence) {
    for (const source of item.sources) {
      if (!byId.has(source.id)) byId.set(source.id, source);
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.verified) - Number(a.verified));
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

/**
 * Enforces the draft rules in code: URLs only from the analysis sources, at most
 * `maxUrls`, no @mentions in replies. Returns the cleaned text, the sources actually
 * cited (in order of appearance) and any warnings.
 */
export function sanitizeDraft(text: string, kind: DraftKind, allowed: Source[]): { text: string; sources: Source[]; warnings: string[] } {
  const warnings = new Set<string>();
  const allowedByUrl = new Map<string, Source>();
  for (const source of allowed) allowedByUrl.set(normalizeUrl(source.url), source);
  const maxUrls = kind === "reply" ? 1 : 2;

  const cited: Source[] = [];
  let cleaned = text.replace(URL_RE, (raw) => {
    const url = trimTrailingPunctuation(raw);
    const trailing = raw.slice(url.length);
    const source = allowedByUrl.get(normalizeUrl(url));
    if (!source) {
      warnings.add(DRAFT_WARNINGS.removedForeignUrl);
      return trailing;
    }
    if (cited.some((s) => s.id === source.id)) return source.url + trailing; // repeated mention of a cited source: keep the text intact
    if (cited.length >= maxUrls) {
      warnings.add(DRAFT_WARNINGS.removedExtraUrl(maxUrls));
      return trailing;
    }
    cited.push(source);
    return source.url + trailing;
  });

  if (kind === "reply") {
    const withoutMentions = cleaned.replace(/(^|[^\w])@[A-Za-z0-9_]{1,15}\b/g, "$1");
    if (withoutMentions !== cleaned) {
      warnings.add(DRAFT_WARNINGS.removedMention);
      cleaned = withoutMentions;
    }
  }

  cleaned = cleaned.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();

  if (kind === "reply" && cleaned.length > REPLY_LENGTH_LIMIT) warnings.add(DRAFT_WARNINGS.replyTooLong);
  if (cited.some((s) => !s.verified)) warnings.add(DRAFT_WARNINGS.unverifiedSource);

  return { text: cleaned, sources: cited, warnings: [...warnings] };
}

/** Adds the best available source URL to a Community Note that cites none. */
export function ensureNoteSource(text: string, cited: Source[], allowed: Source[]): { text: string; sources: Source[]; added: boolean } {
  if (cited.length > 0) return { text, sources: cited, added: false };
  const best = allowed.find((s) => s.verified) ?? allowed[0];
  if (!best) return { text, sources: cited, added: false };
  return { text: `${text.trim()} ${best.url}`.trim(), sources: [best], added: true };
}

export function draftLanguage(request: DraftRequest): string {
  return request.options?.preferences?.language?.trim() || request.post.language?.trim() || "the language of the post";
}

export interface DraftDeps {
  provider: ModelProvider;
  log?: Logger;
}

/** Stage 6 (on demand): a reply or a Community Note draft. Never posted automatically. */
export async function generateDraft(request: DraftRequest, deps: DraftDeps): Promise<DraftResponse> {
  const log = deps.log ?? silentLogger;
  const started = performance.now();
  const allowed = collectAnalysisSources(request.analysis);
  const language = draftLanguage(request);

  const result = await deps.provider.structured({
    stage: `draft:${request.kind}`,
    system: draftPrompt.system(request.kind),
    user: draftPrompt.user(request.kind, request.post, request.analysis, allowed, language),
    schema: DraftOutputSchema,
  });
  if (!result.ok) {
    log.warn(`draft ${request.kind} failed (${result.reason}): ${result.message}`);
    throw new DraftFailedError(`Draft generation failed: ${describeFailure(result)} (${result.message})`, result.reason);
  }

  if (result.usage) log.info(`draft ${request.kind}: tokens ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  const sanitized = sanitizeDraft(result.value.text, request.kind, allowed);
  const warnings = [...sanitized.warnings];
  let text = sanitized.text;
  let sources = sanitized.sources;

  if (request.kind === "community_note") {
    const ensured = ensureNoteSource(text, sources, allowed);
    text = ensured.text;
    sources = ensured.sources;
    if (ensured.added && !ensured.sources[0]?.verified && !warnings.includes(DRAFT_WARNINGS.unverifiedSource)) warnings.push(DRAFT_WARNINGS.unverifiedSource);
    if (sources.length === 0) warnings.push(NO_SOURCE_WARNING);
  }

  return {
    kind: request.kind,
    text,
    sources,
    warnings,
    meta: { mode: "live", model: deps.provider.model, durationMs: Math.round(performance.now() - started) },
  };
}
