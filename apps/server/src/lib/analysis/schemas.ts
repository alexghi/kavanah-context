import { z } from "zod";
import {
  ClaimTypeSchema,
  CommunityNoteRecommendationSchema,
  ConfidenceSchema,
  ContentLabelSchema,
  EngagementRecommendationSchema,
  EvidenceVerdictSchema,
  IhraPatternSchema,
  ManipulationSignalSchema,
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
  manipulationSignals: z.array(ManipulationSignalSchema),
  antisemitism: z.object({
    assessment: z.enum(["not_detected", "possible", "likely"]),
    /** IHRA patterns the post plausibly includes (screening; the full review confirms them) */
    patterns: z.array(IhraPatternSchema),
    explanation: z.string(),
    /** true = run the full IHRA review (the post touches Jews, Israel, Zionism, the Holocaust, Nazism or tropes) */
    needsIhraReview: z.boolean(),
  }),
});
export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

/**
 * Full IHRA assessment (stage "assessIhra"). Optional parts of the shared contract are sent as
 * objects with a present / needed flag, so the model always returns the same shape. Enum-valued
 * fields inside arrays (pattern, dimension, basis, mechanism) are plain strings here: the
 * structured-output grammar has a size limit and nested enums blow past it. The prompt lists the
 * exact values and `buildIhraAssessment` normalizes them (unknown values are dropped).
 */
export const IhraOutputSchema = z.object({
  assessment: z.enum(["not_detected", "possible", "likely"]),
  confidence: ConfidenceSchema,
  summary: z.string(),
  findings: z.array(
    z.object({
      /** an IhraPattern value */
      pattern: z.string(),
      trigger: z.string(),
      ihraExample: z.string(),
      whyItApplies: z.string(),
      strengthens: z.array(z.string()),
      weakens: z.array(z.string()),
      facts: z.array(z.string()),
      interpretations: z.array(z.string()),
      confidence: ConfidenceSchema,
    }),
  ),
  mechanism: z.string(),
  historicalContext: z.string(),
  omittedDifferences: z.array(z.string()),
  analogy: z.object({
    present: z.boolean(),
    historicalReferent: z.string(),
    contemporaryReferent: z.string(),
    /** AnalogyMechanism values */
    mechanisms: z.array(z.string()),
    mechanismExplanation: z.string(),
    suppressesMaterialDifferences: z.boolean(),
    conclusion: z.string(),
  }),
  tropeTransfers: z.array(
    z.object({
      originalTrope: z.string(),
      substitution: z.string(),
      contemporaryTarget: z.string(),
      stereotypePreserved: z.boolean(),
      explanation: z.string(),
    }),
  ),
  semanticDisplacements: z.array(
    z.object({
      historicalReferent: z.string(),
      operation: z.string(),
      newReferent: z.string(),
      consequence: z.string(),
    }),
  ),
  doubleStandard: z.object({
    present: z.boolean(),
    comparator: z.string(),
    asymmetry: z.string(),
  }),
  communityNote2: z.object({
    needed: z.boolean(),
    text: z.string(),
    sourceIds: z.array(z.string()),
  }),
  /** every source id the assessment relies on */
  sourceIds: z.array(z.string()),
});
export type IhraOutput = z.infer<typeof IhraOutputSchema>;

/** The point-by-point comparison of a Nazi / Holocaust analogy (stage "compareAnalogy", parallel to assessIhra). */
export const AnalogyRowsOutputSchema = z.object({
  /** false when, on inspection, the post makes no such comparison */
  present: z.boolean(),
  rows: z.array(
    z.object({
      /** a ComparisonDimension value */
      dimension: z.string(),
      historical: z.string(),
      contemporary: z.string(),
      difference: z.string(),
      /** StatementBasis values */
      historicalBasis: z.string(),
      contemporaryBasis: z.string(),
      sourceIds: z.array(z.string()),
    }),
  ),
});
export type AnalogyRowsOutput = z.infer<typeof AnalogyRowsOutputSchema>;

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
