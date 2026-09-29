import type { AnalysisPreferences, Claim, EvidenceItem, PostContext, Source } from "@kavannah/shared";
import type { CandidateSource, ModelProvider, ModelResult } from "../../ai/provider.js";
import { assessEvidencePrompt } from "../prompts.js";
import { EvidenceOutputSchema, type EvidenceOutput } from "../schemas.js";

/** Stage 4: assess evidence (structured). Source ids MUST come from the candidate list. */
export function assessEvidence(
  provider: ModelProvider,
  post: PostContext,
  claims: Claim[],
  candidates: CandidateSource[],
  notes: string,
  preferences: AnalysisPreferences | undefined,
): Promise<ModelResult<EvidenceOutput>> {
  return provider.structured({
    stage: "assessEvidence",
    system: assessEvidencePrompt.system,
    user: assessEvidencePrompt.user(post, claims, candidates, notes, preferences),
    schema: EvidenceOutputSchema,
    maxTokens: 8000,
  });
}

export const NO_RELEVANT_SOURCE_SUMMARY =
  "The evidence stage did not return an assessment for this claim; no source could be attached. Treat the claim as unverified.";

/**
 * Builds the final evidence items. Enforced in code, not by prompt:
 * - sources are looked up by id in the verified source table; unknown ids are dropped;
 * - every researched claim gets exactly one item (missing ones → insufficient_evidence);
 * - a verdict that claims support/contradiction without any surviving source is downgraded
 *   to insufficient_evidence, so the UI never shows a sourced-looking verdict with no source.
 */
export function buildEvidenceItems(
  output: EvidenceOutput,
  claims: Claim[],
  sourcesById: Map<string, Source>,
): { items: EvidenceItem[]; droppedSourceIds: string[] } {
  const droppedSourceIds: string[] = [];
  const byClaim = new Map<string, EvidenceOutput["assessments"][number]>();
  for (const assessment of output.assessments) {
    if (!byClaim.has(assessment.claimId)) byClaim.set(assessment.claimId, assessment);
  }

  const items: EvidenceItem[] = claims.map((claim) => {
    const assessment = byClaim.get(claim.id);
    if (!assessment) {
      return { claimId: claim.id, claim: claim.text, verdict: "insufficient_evidence", summary: NO_RELEVANT_SOURCE_SUMMARY, sources: [] };
    }
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const ref of assessment.sources) {
      const source = sourcesById.get(ref.id);
      if (!source) {
        droppedSourceIds.push(ref.id);
        continue;
      }
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      const copy: Source = { ...source };
      if (ref.whyItMatters.trim()) copy.whyItMatters = ref.whyItMatters.trim();
      sources.push(copy);
    }
    let verdict = assessment.verdict;
    let summary = assessment.summary.trim();
    if (sources.length === 0 && (verdict === "supported" || verdict === "contradicted" || verdict === "partially_supported")) {
      verdict = "insufficient_evidence";
      summary = `${summary} (No retrievable source could be attached to this assessment, so it is reported as insufficient evidence.)`.trim();
    }
    return { claimId: claim.id, claim: claim.text, verdict, summary: summary || NO_RELEVANT_SOURCE_SUMMARY, sources };
  });

  return { items, droppedSourceIds };
}
