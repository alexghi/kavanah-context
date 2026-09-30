import type { Claim, Classification, CommunityNote, EvidenceItem, IhraAssessment, PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
import { recommendCommunityNotePrompt } from "../prompts.js";
import { CommunityNoteOutputSchema, type CommunityNoteOutput } from "../schemas.js";

/** Stage 5b: "Should I add a Community Note?" — its own prompt; never sees the engagement answer. */
export function recommendCommunityNote(
  provider: ModelProvider,
  post: PostContext,
  classification: Classification,
  claims: Claim[],
  evidence: EvidenceItem[],
  evidenceStatus: string,
  ihra?: IhraAssessment,
): Promise<ModelResult<CommunityNoteOutput>> {
  return provider.structured({
    stage: "recommendCommunityNote",
    system: recommendCommunityNotePrompt.system,
    user: recommendCommunityNotePrompt.user(post, classification, claims, evidence, evidenceStatus, ihra),
    schema: CommunityNoteOutputSchema,
  });
}

export function toCommunityNote(output: CommunityNoteOutput): CommunityNote {
  return { recommendation: output.recommendation, rationale: output.rationale.trim() };
}
