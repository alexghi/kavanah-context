import { z } from "zod";
import {
  AntisemitismCategorySchema,
  ClaimTypeSchema,
  CommunityNoteRecommendationSchema,
  ConfidenceSchema,
  ContentLabelSchema,
  EngagementRecommendationSchema,
  EvidenceVerdictSchema,
} from "@kavannah/shared";

/**
 * Schemas SENT TO THE MODEL for structured output. Deliberately simple: objects,
 * strings, enums, booleans, numbers, arrays. No numeric ranges, regexes, string
 * formats or defaults — ranges are validated and clamped in code afterwards.
 */

export const ClaimsOutputSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      type: ClaimTypeSchema,
      checkworthy: z.boolean(),
      reason: z.string(),
    }),
  ),
});
export type ClaimsOutput = z.infer<typeof ClaimsOutputSchema>;

export const ClassificationOutputSchema = z.object({
  headline: z.string(),
  labels: z.array(ContentLabelSchema),
  explanation: z.string(),
  confidence: ConfidenceSchema,
  disinformationScore: z.number(),
  antisemitism: z.object({
    assessment: z.enum(["not_detected", "possible", "likely"]),
    categories: z.array(AntisemitismCategorySchema),
    explanation: z.string(),
  }),
});
export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

export const EvidenceOutputSchema = z.object({
  assessments: z.array(
    z.object({
      claimId: z.string(),
      verdict: EvidenceVerdictSchema,
      summary: z.string(),
      sources: z.array(
        z.object({
          id: z.string(),
          whyItMatters: z.string(),
        }),
      ),
    }),
  ),
});
export type EvidenceOutput = z.infer<typeof EvidenceOutputSchema>;

export const EngagementOutputSchema = z.object({
  recommendation: EngagementRecommendationSchema,
  rationale: z.string(),
});
export type EngagementOutput = z.infer<typeof EngagementOutputSchema>;

export const CommunityNoteOutputSchema = z.object({
  recommendation: CommunityNoteRecommendationSchema,
  rationale: z.string(),
});
export type CommunityNoteOutput = z.infer<typeof CommunityNoteOutputSchema>;

export const DraftOutputSchema = z.object({
  text: z.string(),
  /** ids of the analysis sources whose URLs appear in the text */
  sourceIds: z.array(z.string()),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;
