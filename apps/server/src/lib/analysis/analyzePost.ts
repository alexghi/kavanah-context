import type {
  AnalyzeOptions,
  AnalyzePostResponse,
  Claim,
  Classification,
  CommunityNote,
  Engagement,
  EvidenceItem,
  PostContext,
  Source,
  StageReport,
} from "@kavannah/shared";
import { describeFailure, type CandidateSource, type ModelProvider, type ModelResult, type StageFailureReason, type TokenUsage } from "../ai/provider.js";
import { silentLogger, type Logger } from "../log.js";
import { validateUrl, validateUrls, type UrlValidator } from "../sources/validateUrl.js";
import { assessEvidence, buildEvidenceItems } from "./stages/assessEvidence.js";
import { classifyContent, toClassification } from "./stages/classifyContent.js";
import { extractClaims, toClaims } from "./stages/extractClaims.js";
import { recommendCommunityNote, toCommunityNote } from "./stages/recommendCommunityNote.js";
import { recommendEngagement, toEngagement } from "./stages/recommendEngagement.js";
import { retrieveEvidence, selectClaimsForResearch } from "./stages/retrieveEvidence.js";

/** Thrown when the classification stage fails twice: the analysis cannot be produced. */
export class AnalysisFailedError extends Error {
  readonly code = "analysis_failed" as const;
  constructor(
    message: string,
    readonly reason: StageFailureReason,
  ) {
    super(message);
    this.name = "AnalysisFailedError";
  }
}

export const WARNINGS = {
  claimExtractionFailed: "Claim extraction failed; evidence could not be assessed.",
  refusal: "The model declined to analyze part of this content.",
  retrievalUnavailable: "Live source retrieval was unavailable; the claims could not be checked against sources.",
  noSourcesRetrieved: "No sources could be retrieved for the check-worthy claims; they remain unverified.",
  assessmentFailed: "Evidence assessment did not complete; the claims could not be checked against sources.",
  engagementFailed: (reason: string) => `The "Should I engage?" recommendation did not complete: ${reason}.`,
  noteFailed: (reason: string) => `The "Should I add a Community Note?" recommendation did not complete: ${reason}.`,
  unverifiedSources: (n: number) => `${n} source URL${n === 1 ? "" : "s"} could not be verified by the backend; check ${n === 1 ? "it" : "them"} before relying on ${n === 1 ? "it" : "them"}.`,
  droppedSourceIds: "The model referenced source ids that were not in the retrieved list; they were dropped.",
} as const;

export const EVIDENCE_UNAVAILABLE_SUMMARY =
  "Live source retrieval was unavailable, so this claim could not be checked against sources. Treat it as unverified, not as false.";
export const EVIDENCE_NONE_RETRIEVED_SUMMARY =
  "No sources could be retrieved for this claim, so it could not be checked. Treat it as unverified, not as false.";
export const EVIDENCE_ASSESSMENT_FAILED_SUMMARY =
  "Sources were retrieved but the evidence assessment did not complete, so this claim could not be checked. Treat it as unverified.";

export function recommendationFallback(result: { reason: StageFailureReason; message: string }): { recommendation: "uncertain"; rationale: string } {
  return { recommendation: "uncertain", rationale: `The recommendation stage did not complete: ${describeFailure(result)}.` };
}

export interface AnalyzeDeps {
  provider: ModelProvider;
  /** Injectable URL checker (tests). Defaults to a real HEAD/GET check with a 5s timeout. */
  validateUrl?: UrlValidator;
  log?: Logger;
  now?: () => Date;
}

interface Timed<T> {
  result: ModelResult<T>;
  ms: number;
}

async function timed<T>(fn: () => Promise<ModelResult<T>>): Promise<Timed<T>> {
  const started = performance.now();
  try {
    const result = await fn();
    return { result, ms: Math.round(performance.now() - started) };
  } catch (err) {
    // A provider must not throw, but if it does, treat it as an API error rather than crashing the analysis.
    return {
      result: { ok: false, reason: "api_error", message: err instanceof Error ? err.message : String(err) },
      ms: Math.round(performance.now() - started),
    };
  }
}

function unavailableEvidence(claims: Claim[], summary: string): EvidenceItem[] {
  return claims.map((c) => ({ claimId: c.id, claim: c.text, verdict: "insufficient_evidence", summary, sources: [] }));
}

function usageNote(result: ModelResult<unknown>): string {
  return result.ok && result.usage ? `; tokens ${result.usage.inputTokens} in / ${result.usage.outputTokens} out` : "";
}

function addUsage(total: TokenUsage, result: ModelResult<unknown>): void {
  if (result.ok && result.usage) {
    total.inputTokens += result.usage.inputTokens;
    total.outputTokens += result.usage.outputTokens;
  }
}

function candidateToSource(candidate: CandidateSource, verified: boolean): Source {
  const source: Source = {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    publisher: candidate.publisher,
    retrievedVia: "web_search",
    verified,
  };
  if (candidate.snippet) source.snippet = candidate.snippet;
  return source;
}

/**
 * The analysis pipeline. Stages 1+2 run in parallel, then 3 → 4, then 5a ‖ 5b.
 * Every degradation path documented in the brief is handled here and produces a
 * response that still validates against AnalyzePostResponseSchema.
 */
export async function analyzePost(post: PostContext, options: AnalyzeOptions | undefined, deps: AnalyzeDeps): Promise<AnalyzePostResponse> {
  const { provider } = deps;
  const log = deps.log ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const urlValidator: UrlValidator = deps.validateUrl ?? ((url) => validateUrl(url));
  const preferences = options?.preferences;
  const started = performance.now();
  const analyzedAt = now().toISOString();
  const stages: StageReport[] = [];
  const warnings: string[] = [];
  const tokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const noteFailure = (stage: string, result: { reason: StageFailureReason; message: string }) => {
    if (result.reason === "refusal") warn(WARNINGS.refusal);
    log.warn(`${stage} failed (${result.reason}): ${result.message}`);
  };

  // ---- Stage 1 ‖ Stage 2 -------------------------------------------------
  const classifyWithRetry = async (): Promise<Timed<Classification> & { note?: string }> => {
    const first = await timed(() => classifyContent(provider, post));
    addUsage(tokens, first.result);
    if (first.result.ok) return { result: { ok: true, value: toClassification(first.result.value), usage: first.result.usage }, ms: first.ms, note: usageNote(first.result).replace(/^; /, "") || undefined };
    noteFailure("classifyContent", first.result);
    const second = await timed(() => classifyContent(provider, post));
    addUsage(tokens, second.result);
    const ms = first.ms + second.ms;
    if (second.result.ok) {
      return { result: { ok: true, value: toClassification(second.result.value), usage: second.result.usage }, ms, note: `succeeded on retry (first attempt: ${first.result.reason})${usageNote(second.result)}` };
    }
    noteFailure("classifyContent(retry)", second.result);
    return { result: second.result, ms, note: `failed twice (${first.result.reason}, ${second.result.reason})` };
  };

  const [claimsRun, classifyRun] = await Promise.all([timed(() => extractClaims(provider, post)), classifyWithRetry()]);

  let claims: Claim[] = [];
  addUsage(tokens, claimsRun.result);
  if (claimsRun.result.ok) {
    claims = toClaims(claimsRun.result.value);
    stages.push({ name: "extractClaims", ms: claimsRun.ms, ok: true, note: `${claims.length} claim${claims.length === 1 ? "" : "s"}, ${claims.filter((c) => c.checkworthy).length} check-worthy${usageNote(claimsRun.result)}` });
  } else {
    noteFailure("extractClaims", claimsRun.result);
    warn(WARNINGS.claimExtractionFailed);
    stages.push({ name: "extractClaims", ms: claimsRun.ms, ok: false, note: `${claimsRun.result.reason}: ${claimsRun.result.message}` });
  }

  const classifyReport: StageReport = { name: "classifyContent", ms: classifyRun.ms, ok: classifyRun.result.ok };
  if (classifyRun.note) classifyReport.note = classifyRun.note;
  stages.push(classifyReport);
  if (!classifyRun.result.ok) {
    throw new AnalysisFailedError(`Content classification failed: ${describeFailure(classifyRun.result)} (${classifyRun.result.message})`, classifyRun.result.reason);
  }
  const classification = classifyRun.result.value;

  // ---- Stage 3 → Stage 4 ---------------------------------------------------
  const researched = selectClaimsForResearch(claims);
  let evidence: EvidenceItem[] = [];
  let evidenceStatus = "no check-worthy claims; nothing to verify";

  if (researched.length === 0) {
    stages.push({ name: "retrieveEvidence", ms: 0, ok: true, note: claims.length ? "skipped: no check-worthy claims" : "skipped: no claims" });
    if (!claimsRun.result.ok) evidenceStatus = "claim extraction failed; nothing could be verified";
  } else if (!provider.webSearchAvailable) {
    stages.push({ name: "retrieveEvidence", ms: 0, ok: false, note: "web search disabled" });
    warn(WARNINGS.retrievalUnavailable);
    evidence = unavailableEvidence(researched, EVIDENCE_UNAVAILABLE_SUMMARY);
    evidenceStatus = "live source retrieval unavailable; claims unverified";
  } else {
    const searchRun = await timed(() => retrieveEvidence(provider, post, researched, preferences));
    addUsage(tokens, searchRun.result);
    if (!searchRun.result.ok) {
      noteFailure("retrieveEvidence", searchRun.result);
      stages.push({ name: "retrieveEvidence", ms: searchRun.ms, ok: false, note: `${searchRun.result.reason}: ${searchRun.result.message}` });
      warn(WARNINGS.retrievalUnavailable);
      evidence = unavailableEvidence(researched, EVIDENCE_UNAVAILABLE_SUMMARY);
      evidenceStatus = "live source retrieval failed; claims unverified";
    } else {
      const outcome = searchRun.result.value;
      const toolNote = outcome.toolErrors.length ? `, tool errors: ${outcome.toolErrors.join(",")}` : "";
      const resumeNote = outcome.resumed ? `, resumed ${outcome.resumed}x` : "";
      stages.push({
        name: "retrieveEvidence",
        ms: searchRun.ms,
        ok: true,
        note: `${outcome.searches} search${outcome.searches === 1 ? "" : "es"}, ${outcome.candidates.length} candidate source${outcome.candidates.length === 1 ? "" : "s"}${toolNote}${resumeNote}${usageNote(searchRun.result)}`,
      });

      if (outcome.candidates.length === 0) {
        warn(WARNINGS.noSourcesRetrieved);
        evidence = unavailableEvidence(researched, EVIDENCE_NONE_RETRIEVED_SUMMARY);
        evidenceStatus = "search returned no usable sources; claims unverified";
        stages.push({ name: "assessEvidence", ms: 0, ok: true, note: "skipped: no candidate sources" });
      } else {
        // Verify every candidate URL (code-level guarantee, independent of the model).
        const verifyStarted = performance.now();
        const checks = await validateUrls(
          outcome.candidates.map((c) => c.url),
          urlValidator,
        );
        const sourcesById = new Map<string, Source>();
        let unverified = 0;
        for (const candidate of outcome.candidates) {
          const check = checks.get(candidate.url);
          const verified = Boolean(check?.ok);
          if (!verified) unverified += 1;
          sourcesById.set(candidate.id, candidateToSource(candidate, verified));
        }
        stages.push({ name: "verifySources", ms: Math.round(performance.now() - verifyStarted), ok: true, note: `${outcome.candidates.length - unverified}/${outcome.candidates.length} URLs verified` });

        const assessRun = await timed(() => assessEvidence(provider, post, researched, outcome.candidates, outcome.notes, preferences));
        addUsage(tokens, assessRun.result);
        if (!assessRun.result.ok) {
          noteFailure("assessEvidence", assessRun.result);
          stages.push({ name: "assessEvidence", ms: assessRun.ms, ok: false, note: `${assessRun.result.reason}: ${assessRun.result.message}` });
          warn(WARNINGS.assessmentFailed);
          evidence = unavailableEvidence(researched, EVIDENCE_ASSESSMENT_FAILED_SUMMARY);
          evidenceStatus = "sources retrieved but assessment failed; claims unverified";
        } else {
          const built = buildEvidenceItems(assessRun.result.value, researched, sourcesById);
          evidence = built.items;
          if (built.droppedSourceIds.length) {
            log.warn(`assessEvidence referenced unknown source ids: ${built.droppedSourceIds.join(", ")}`);
            warn(WARNINGS.droppedSourceIds);
          }
          const usedUnverified = new Set(evidence.flatMap((e) => e.sources.filter((s) => !s.verified).map((s) => s.id))).size;
          if (usedUnverified > 0) warn(WARNINGS.unverifiedSources(usedUnverified));
          stages.push({ name: "assessEvidence", ms: assessRun.ms, ok: true, note: `${evidence.map((e) => `${e.claimId}=${e.verdict}`).join(", ")}${usageNote(assessRun.result)}` });
          evidenceStatus = "claims assessed against retrieved sources (see verdicts)";
        }
      }
    }
  }

  // ---- Stage 5a ‖ Stage 5b (independent prompts, neither sees the other) -----
  const [engagementRun, noteRun] = await Promise.all([
    timed(() => recommendEngagement(provider, post, classification, claims, evidence, evidenceStatus)),
    timed(() => recommendCommunityNote(provider, post, classification, claims, evidence, evidenceStatus)),
  ]);

  addUsage(tokens, engagementRun.result);
  addUsage(tokens, noteRun.result);

  let engagement: Engagement;
  if (engagementRun.result.ok) {
    engagement = toEngagement(engagementRun.result.value);
    stages.push({ name: "recommendEngagement", ms: engagementRun.ms, ok: true, note: `${engagement.recommendation}${usageNote(engagementRun.result)}` });
  } else {
    noteFailure("recommendEngagement", engagementRun.result);
    engagement = recommendationFallback(engagementRun.result);
    warn(WARNINGS.engagementFailed(describeFailure(engagementRun.result)));
    stages.push({ name: "recommendEngagement", ms: engagementRun.ms, ok: false, note: `${engagementRun.result.reason}: ${engagementRun.result.message}` });
  }

  let communityNote: CommunityNote;
  if (noteRun.result.ok) {
    communityNote = toCommunityNote(noteRun.result.value);
    stages.push({ name: "recommendCommunityNote", ms: noteRun.ms, ok: true, note: `${communityNote.recommendation}${usageNote(noteRun.result)}` });
  } else {
    noteFailure("recommendCommunityNote", noteRun.result);
    communityNote = recommendationFallback(noteRun.result);
    warn(WARNINGS.noteFailed(describeFailure(noteRun.result)));
    stages.push({ name: "recommendCommunityNote", ms: noteRun.ms, ok: false, note: `${noteRun.result.reason}: ${noteRun.result.message}` });
  }

  const durationMs = Math.round(performance.now() - started);
  log.info(`analysis done in ${durationMs} ms; tokens ${tokens.inputTokens} in / ${tokens.outputTokens} out; warnings: ${warnings.length}`);

  return {
    post,
    classification,
    claims,
    evidence,
    engagement,
    communityNote,
    meta: {
      version: 1,
      mode: "live",
      model: provider.model,
      analyzedAt,
      durationMs,
      stages,
      warnings,
    },
  };
}
