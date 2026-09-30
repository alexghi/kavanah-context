import { legacyCategoriesFor, type Classification, type PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
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
  };
  // Anything the screening flags goes to the full review, whatever the flag says.
  const needsIhraReview = output.antisemitism.needsIhraReview || output.antisemitism.assessment !== "not_detected" || patterns.length > 0;
  return { classification, needsIhraReview };
}
