import type {
  AnalysisPhase,
  AnalysisProgress,
  AnalyzeOptions,
  AnalyzePostResponse,
  Claim,
  Classification,
  CommunityNote,
  Engagement,
  EvidenceItem,
  IhraAssessment,
  PostContext,
  Source,
  StageReport,
} from "@kavannah/shared";
import { describeFailure, type CandidateSource, type ModelProvider, type ModelResult, type StageFailureReason, type TokenUsage } from "../ai/provider.js";
import { silentLogger, type Logger } from "../log.js";
import { validateUrl, validateUrls, type UrlValidator } from "../sources/validateUrl.js";
import { assessEvidence, buildEvidenceItems } from "./stages/assessEvidence.js";
import { assessIhra, buildIhraAssessment, compareAnalogy, reconcileClassification } from "./stages/assessIhra.js";
import { classifyContent, toClassification, type ScreenedClassification } from "./stages/classifyContent.js";
import { extractClaims, toClaims } from "./stages/extractClaims.js";
import { recommendCommunityNote, toCommunityNote } from "./stages/recommendCommunityNote.js";
import { recommendEngagement, toEngagement } from "./stages/recommendEngagement.js";
import { analogySuspected } from "./prompts.js";
import { MAX_IHRA_CANDIDATES, prefixCandidates, researchIhra } from "./stages/researchIhra.js";
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
  ihraResearchUnavailable: "Source retrieval for the IHRA review was unavailable; its historical and factual context rests on well-established facts only.",
  ihraFailed: (reason: string) => `The full IHRA review did not complete (${reason}); the antisemitism result comes from the initial screening.`,
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
  /** Called with a snapshot each time a part of the analysis is ready (progressive delivery). */
  onProgress?: (progress: AnalysisProgress) => void;
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
 * The analysis pipeline. Stage 1 (claims, fast tier) and stage 2 (classification with the IHRA
 * screening) start together; the evidence chain (3 → 4) starts as soon as the claims are in, the
 * IHRA research (3b) as soon as the screening flags the post; then 5c (full IHRA assessment) and
 * finally 5a ‖ 5b. `onProgress` receives a snapshot after the classification, the evidence, the
 * IHRA review and at the end.
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

  // Shared by the overlapping chains below.
  const claimStages: StageReport[] = [];
  const ihraStages: StageReport[] = [];
  let classifyReport: StageReport | null = null;
  let evidenceStages: StageReport[] = [];
  let claims: Claim[] = [];
  let claimsDone = false;
  let claimsExtracted = false;
  let evidence: EvidenceItem[] = [];
  let evidenceDone = false;
  let evidenceStatus = "no check-worthy claims; nothing to verify";
  let classification: Classification | null = null;
  let ihraPending = false;
  let ihra: IhraAssessment | undefined;
  const allStages = (): StageReport[] => [...claimStages, ...(classifyReport ? [classifyReport] : []), ...evidenceStages, ...ihraStages, ...stages];
  let lastEmitted = "";
  const emit = (phase: AnalysisPhase) => {
    if (!deps.onProgress || !classification) return;
    // The same snapshot twice (e.g. the evidence chain finished before the classification) is noise.
    const signature = `${phase}|${claimsDone}|${evidenceDone}|${Boolean(ihra)}|${ihraPending}`;
    if (signature === lastEmitted) return;
    lastEmitted = signature;
    const snapshot: AnalysisProgress = {
      phase,
      post,
      classification,
      ihraPending,
      stages: allStages(),
      warnings: [...warnings],
      elapsedMs: Math.round(performance.now() - started),
    };
    if (claimsDone) snapshot.claims = claims;
    if (evidenceDone) snapshot.evidence = evidence;
    if (ihra) snapshot.ihra = ihra;
    try {
      deps.onProgress(snapshot);
    } catch (err) {
      log.warn(`onProgress threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ---- Stage 1 ‖ Stage 2 -------------------------------------------------
  const classifyWithRetry = async (): Promise<Timed<ScreenedClassification> & { note?: string }> => {
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

  const claimsPromise = timed(() => extractClaims(provider, post));
  const classifyPromise = classifyWithRetry();

  // ---- Stage 3 → Stage 4, chained on the claims (it does not wait for the classification) ----
  const evidenceChain = (async (): Promise<StageReport[]> => {
    const claimsRun = await claimsPromise;
    addUsage(tokens, claimsRun.result);
    if (claimsRun.result.ok) {
      claims = toClaims(claimsRun.result.value);
      claimsExtracted = true;
      claimStages.push({ name: "extractClaims", ms: claimsRun.ms, ok: true, note: `${claims.length} claim${claims.length === 1 ? "" : "s"}, ${claims.filter((c) => c.checkworthy).length} check-worthy${usageNote(claimsRun.result)}` });
    } else {
      noteFailure("extractClaims", claimsRun.result);
      warn(WARNINGS.claimExtractionFailed);
      claimStages.push({ name: "extractClaims", ms: claimsRun.ms, ok: false, note: `${claimsRun.result.reason}: ${claimsRun.result.message}` });
    }
    claimsDone = true;
    const researched = selectClaimsForResearch(claims);
    try {
      return await runEvidence(researched);
    } finally {
      evidenceDone = true;
    }
  })();

  const evidenceSources = new Map<string, Source>();

  // A function declaration (hoisted): the evidence chain above references it before this line runs.
  async function runEvidence(researched: Claim[]): Promise<StageReport[]> {
  const stages: StageReport[] = [];

  if (researched.length === 0) {
    stages.push({ name: "retrieveEvidence", ms: 0, ok: true, note: claims.length ? "skipped: no check-worthy claims" : "skipped: no claims" });
    if (!claimsExtracted) evidenceStatus = "claim extraction failed; nothing could be verified";
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
          stages.push({ name: "assessEvidence", ms: assessRun.ms, ok: true, note: `${evidence.map((e) => `${e.claimId}=${e.verdict}`).join(", ")}${usageNote(assessRun.result)}` });
          evidenceStatus = "claims assessed against retrieved sources (see verdicts)";
        }
      }
    }
  }
  return stages;
  }

  interface IhraResearch {
    candidates: CandidateSource[];
    notes: string;
    sources: Map<string, Source>;
    stages: StageReport[];
  }
  const runIhraResearch = async (): Promise<IhraResearch> => {
    const stages: StageReport[] = [];
    const empty = (): IhraResearch => ({ candidates: [], notes: "", sources: new Map(), stages });
    if (!provider.webSearchAvailable) {
      stages.push({ name: "researchIhra", ms: 0, ok: false, note: "web search disabled" });
      warn(WARNINGS.ihraResearchUnavailable);
      return empty();
    }
    const run = await timed(() => researchIhra(provider, post, classification!));
    addUsage(tokens, run.result);
    if (!run.result.ok) {
      noteFailure("researchIhra", run.result);
      stages.push({ name: "researchIhra", ms: run.ms, ok: false, note: `${run.result.reason}: ${run.result.message}` });
      warn(WARNINGS.ihraResearchUnavailable);
      return empty();
    }
    const outcome = run.result.value;
    const candidates = prefixCandidates(outcome.candidates.slice(0, MAX_IHRA_CANDIDATES));
    stages.push({
      name: "researchIhra",
      ms: run.ms,
      ok: true,
      note: `${outcome.searches} search${outcome.searches === 1 ? "" : "es"}, ${candidates.length} candidate source${candidates.length === 1 ? "" : "s"}${usageNote(run.result)}`,
    });
    const sources = new Map<string, Source>();
    if (candidates.length > 0) {
      const verifyStarted = performance.now();
      const checks = await validateUrls(
        candidates.map((c) => c.url),
        urlValidator,
      );
      let verifiedCount = 0;
      for (const candidate of candidates) {
        const verified = Boolean(checks.get(candidate.url)?.ok);
        if (verified) verifiedCount += 1;
        sources.set(candidate.id, candidateToSource(candidate, verified));
      }
      stages.push({ name: "verifyIhraSources", ms: Math.round(performance.now() - verifyStarted), ok: true, note: `${verifiedCount}/${candidates.length} URLs verified` });
    } else {
      warn(WARNINGS.ihraResearchUnavailable);
    }
    return { candidates, notes: outcome.notes, sources, stages };
  };

  // ---- Stage 2 result: the classification is the first thing the panel can show ----
  const classifyRun = await classifyPromise;
  classifyReport = { name: "classifyContent", ms: classifyRun.ms, ok: classifyRun.result.ok };
  if (classifyRun.note) classifyReport.note = classifyRun.note;
  if (!classifyRun.result.ok) {
    void evidenceChain.catch(() => undefined); // let the chain finish quietly; the analysis is over
    throw new AnalysisFailedError(`Content classification failed: ${describeFailure(classifyRun.result)} (${classifyRun.result.message})`, classifyRun.result.reason);
  }
  const screened = classifyRun.result.value;
  let current: Classification = screened.classification;
  classification = current;
  ihraPending = screened.needsIhraReview;
  emit(evidenceDone ? (ihraPending ? "reviewing_ihra" : "recommending") : "checking_evidence");

  // ---- Stage 3b: IHRA research (flagged posts only), in parallel with the evidence chain ----
  const ihraResearchPromise = ihraPending ? runIhraResearch() : Promise.resolve(null);
  evidenceStages = await evidenceChain;
  for (const item of evidence) for (const source of item.sources) evidenceSources.set(source.id, source);
  emit(ihraPending ? "reviewing_ihra" : "recommending");
  const ihraResearch = await ihraResearchPromise;

  // ---- Stage 5c: full IHRA assessment (its result feeds both recommendations) ----
  if (ihraResearch) {
    ihraStages.push(...ihraResearch.stages);
    const allowed = new Map<string, Source>([...evidenceSources, ...ihraResearch.sources]);
    const withComparison = analogySuspected(post, current);
    const [ihraRun, comparisonRun] = await Promise.all([
      timed(() => assessIhra(provider, post, current, claims, evidence, ihraResearch.candidates, ihraResearch.notes)),
      withComparison ? timed(() => compareAnalogy(provider, post, current, claims, evidence, ihraResearch.candidates, ihraResearch.notes)) : Promise.resolve(null),
    ]);
    addUsage(tokens, ihraRun.result);
    if (comparisonRun) {
      addUsage(tokens, comparisonRun.result);
      if (comparisonRun.result.ok) {
        ihraStages.push({ name: "compareAnalogy", ms: comparisonRun.ms, ok: true, note: `${comparisonRun.result.value.present ? `${comparisonRun.result.value.rows.length} dimensions` : "no analogy on inspection"}${usageNote(comparisonRun.result)}` });
      } else {
        noteFailure("compareAnalogy", comparisonRun.result);
        ihraStages.push({ name: "compareAnalogy", ms: comparisonRun.ms, ok: false, note: `${comparisonRun.result.reason}: ${comparisonRun.result.message}` });
      }
    }
    if (ihraRun.result.ok) {
      const built = buildIhraAssessment(ihraRun.result.value, comparisonRun?.result.ok ? comparisonRun.result.value : null, allowed);
      ihra = built.ihra;
      if (built.droppedSourceIds.length) {
        log.warn(`assessIhra referenced unknown source ids: ${built.droppedSourceIds.join(", ")}`);
        warn(WARNINGS.droppedSourceIds);
      }
      current = reconcileClassification(current, ihra);
      classification = current;
      const patterns = [...new Set(ihra.findings.map((f) => f.pattern))];
      ihraStages.push({
        name: "assessIhra",
        ms: ihraRun.ms,
        ok: true,
        note: `${ihra.assessment}; ${patterns.length ? patterns.join(", ") : "no patterns"}${ihra.analogy ? "; analogy compared" : ""}${usageNote(ihraRun.result)}`,
      });
    } else {
      noteFailure("assessIhra", ihraRun.result);
      warn(WARNINGS.ihraFailed(describeFailure(ihraRun.result)));
      ihraStages.push({ name: "assessIhra", ms: ihraRun.ms, ok: false, note: `${ihraRun.result.reason}: ${ihraRun.result.message}` });
    }
    ihraPending = false;
    emit("recommending");
  } else {
    ihraStages.push({ name: "assessIhra", ms: 0, ok: true, note: "skipped: nothing for the IHRA review" });
  }

  // One warning for every unverified source the analysis shows (evidence and IHRA review).
  const shownUnverified = new Set([
    ...evidence.flatMap((e) => e.sources.filter((s) => !s.verified).map((s) => s.url)),
    ...(ihra?.sources ?? []).filter((s) => !s.verified).map((s) => s.url),
  ]).size;
  if (shownUnverified > 0) warn(WARNINGS.unverifiedSources(shownUnverified));

  // ---- Stage 5a ‖ Stage 5b (independent prompts, neither sees the other) -----
  const finalClassification: Classification = current;
  const [engagementRun, noteRun] = await Promise.all([
    timed(() => recommendEngagement(provider, post, finalClassification, claims, evidence, evidenceStatus, ihra)),
    timed(() => recommendCommunityNote(provider, post, finalClassification, claims, evidence, evidenceStatus, ihra)),
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
    classification: finalClassification,
    claims,
    evidence,
    engagement,
    communityNote,
    ...(ihra ? { ihra } : {}),
    meta: {
      version: 1,
      mode: "live",
      model: provider.model,
      analyzedAt,
      durationMs,
      stages: allStages(),
      warnings,
    },
  };
}
