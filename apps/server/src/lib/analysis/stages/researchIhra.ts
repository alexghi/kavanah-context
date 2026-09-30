import type { Classification, PostContext } from "@kavannah/shared";
import type { CandidateSource, ModelProvider, ModelResult, SearchOutcome } from "../../ai/provider.js";
import { researchIhraPrompt, type IhraResearchFocus } from "../prompts.js";
import { mergeSearchOutcomes } from "./retrieveEvidence.js";

/** Id prefix of IHRA research sources ("h1", "h2", …); evidence sources are "s1", "s2", …. */
export const IHRA_SOURCE_PREFIX = "h";
/** Searches per focused research call. */
export const SEARCHES_PER_FOCUS = 2;
export const IHRA_RESEARCH_FOCUSES: IhraResearchFocus[] = ["historical", "contemporary"];
/** Sources kept from the merged research calls (the assessment reads every one; more input = slower). */
export const MAX_IHRA_CANDIDATES = 14;

/**
 * Stage 3b: web search for the context of the IHRA review, as two parallel focused calls
 * (historical / definitional, and contemporary / factual).
 */
export async function researchIhra(provider: ModelProvider, post: PostContext, classification: Classification): Promise<ModelResult<SearchOutcome>> {
  const results = await Promise.all(
    IHRA_RESEARCH_FOCUSES.map(async (focus) => ({
      label: `${focus} context`,
      result: await provider.search({
        stage: "researchIhra",
        system: researchIhraPrompt.system,
        user: researchIhraPrompt.user(post, classification, focus),
        maxUses: SEARCHES_PER_FOCUS,
      }),
    })),
  );
  return mergeSearchOutcomes(results);
}

/** Re-ids IHRA candidates so they never collide with the evidence stage's ids. */
export function prefixCandidates(candidates: CandidateSource[], prefix = IHRA_SOURCE_PREFIX): CandidateSource[] {
  return candidates.map((candidate, index) => ({ ...candidate, id: `${prefix}${index + 1}` }));
}
