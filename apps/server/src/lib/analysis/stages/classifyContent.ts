import {
  ConfidenceSchema,
  legacyCategoriesFor,
  ManipulationTechniqueSchema,
  type Classification,
  type Manipulation,
  type ManipulationFinding,
  type PostContext,
} from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
import { enumValue } from "../enums.js";
import { classifyContentPrompt } from "../prompts.js";
import { ClassificationOutputSchema, type ClassificationOutput } from "../schemas.js";

/** Stage 2: classify content (structured), including the IHRA screening. */
export function classifyContent(provider: ModelProvider, post: PostContext): Promise<ModelResult<ClassificationOutput>> {
  return provider.structured({
    stage: "classifyContent",
    system: classifyContentPrompt.system,
    user: classifyContentPrompt.user(post),
    schema: ClassificationOutputSchema,
  });
}

/** The classification plus the screening decision that drives the IHRA review. */
export interface ScreenedClassification {
  classification: Classification;
  /** Run the IHRA research and assessment stages for this post. */
  needsIhraReview: boolean;
}

export const MAX_MANIPULATION_FINDINGS = 6;

/**
 * Normalizes the manipulation block: unknown techniques are dropped, duplicates keep the first
 * mention, at most MAX_MANIPULATION_FINDINGS remain, and the level always agrees with the list.
 */
export function toManipulation(output: ClassificationOutput["manipulation"]): Manipulation {
  const findings: ManipulationFinding[] = [];
  for (const raw of output.findings) {
    const technique = enumValue(ManipulationTechniqueSchema.options, raw.technique);
    if (!technique || findings.some((f) => f.technique === technique)) continue;
    if (findings.length >= MAX_MANIPULATION_FINDINGS) break;
    findings.push({
      technique,
      trigger: raw.trigger.trim(),
      explanation: raw.explanation.trim(),
      confidence: enumValue(ConfidenceSchema.options, raw.confidence) ?? "medium",
    });
  }
  const level = findings.length === 0 ? "none" : output.level === "none" ? "present" : output.level;
  return { level, summary: level === "none" ? "" : output.summary.trim(), findings };
}

/** Clamps/normalizes the model output into the shared Classification shape. */
export function toClassification(output: ClassificationOutput): ScreenedClassification {
  const score = Number.isFinite(output.disinformationScore) ? output.disinformationScore : 0;
  const labels = [...new Set(output.labels)];
  if (labels.length === 0) labels.push(output.antisemitism.assessment === "not_detected" ? "benign" : "potentially_antisemitic");
  const patterns = [...new Set(output.antisemitism.patterns)];
  const classification: Classification = {
    headline: output.headline.trim() || "No clear factual issue identified",
    labels,
    explanation: output.explanation.trim(),
    confidence: output.confidence,
    disinformationScore: Math.max(0, Math.min(100, Math.round(score))),
    antisemitism: {
      assessment: output.antisemitism.assessment,
      categories: legacyCategoriesFor(patterns),
      explanation: output.antisemitism.explanation.trim(),
      patterns,
    },
    manipulation: toManipulation(output.manipulation),
  };
  // Anything the screening flags goes to the full review, whatever the flag says.
  const needsIhraReview = output.antisemitism.needsIhraReview || output.antisemitism.assessment !== "not_detected" || patterns.length > 0;
  return { classification, needsIhraReview };
}
