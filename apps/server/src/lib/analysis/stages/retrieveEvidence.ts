import type { AnalysisPreferences, Claim, PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult, SearchOutcome } from "../../ai/provider.js";
import { retrieveEvidencePrompt } from "../prompts.js";

export const MAX_RESEARCHED_CLAIMS = 3;

/** The claims that go to research: check-worthy ones, at most MAX_RESEARCHED_CLAIMS. */
export function selectClaimsForResearch(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.checkworthy).slice(0, MAX_RESEARCHED_CLAIMS);
}

/** Stage 3: retrieve evidence with the provider's web search. Candidates are the ONLY allowed sources later. */
export function retrieveEvidence(
  provider: ModelProvider,
  post: PostContext,
  claims: Claim[],
  preferences: AnalysisPreferences | undefined,
): Promise<ModelResult<SearchOutcome>> {
  return provider.search({
    stage: "retrieveEvidence",
    system: retrieveEvidencePrompt.system,
    user: retrieveEvidencePrompt.user(post, claims, preferences),
    maxUses: 6,
  });
}
