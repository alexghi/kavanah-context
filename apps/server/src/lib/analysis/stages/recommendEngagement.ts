import type { Claim, Classification, Engagement, EvidenceItem, PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
import { recommendEngagementPrompt } from "../prompts.js";
import { EngagementOutputSchema, type EngagementOutput } from "../schemas.js";

/** Stage 5a: "Should I engage?" — its own prompt; never sees the Community Note answer. */
export function recommendEngagement(
  provider: ModelProvider,
  post: PostContext,
  classification: Classification,
  claims: Claim[],
  evidence: EvidenceItem[],
  evidenceStatus: string,
): Promise<ModelResult<EngagementOutput>> {
  return provider.structured({
    stage: "recommendEngagement",
    system: recommendEngagementPrompt.system,
    user: recommendEngagementPrompt.user(post, classification, claims, evidence, evidenceStatus),
    schema: EngagementOutputSchema,
  });
}

export function toEngagement(output: EngagementOutput): Engagement {
  return { recommendation: output.recommendation, rationale: output.rationale.trim() };
}
