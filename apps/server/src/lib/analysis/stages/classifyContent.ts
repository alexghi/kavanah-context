import type { Classification, PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
import { classifyContentPrompt } from "../prompts.js";
import { ClassificationOutputSchema, type ClassificationOutput } from "../schemas.js";

/** Stage 2: classify content (structured). */
export function classifyContent(provider: ModelProvider, post: PostContext): Promise<ModelResult<ClassificationOutput>> {
  return provider.structured({
    stage: "classifyContent",
    system: classifyContentPrompt.system,
    user: classifyContentPrompt.user(post),
    schema: ClassificationOutputSchema,
  });
}

/** Clamps/normalizes the model output into the shared Classification shape. */
export function toClassification(output: ClassificationOutput): Classification {
  const score = Number.isFinite(output.disinformationScore) ? output.disinformationScore : 0;
  const labels = [...new Set(output.labels)];
  if (labels.length === 0) labels.push(output.antisemitism.assessment === "not_detected" ? "benign" : "potentially_antisemitic");
  return {
    headline: output.headline.trim() || "No clear factual issue identified",
    labels,
    explanation: output.explanation.trim(),
    confidence: output.confidence,
    disinformationScore: Math.max(0, Math.min(100, Math.round(score))),
    antisemitism: {
      assessment: output.antisemitism.assessment,
      categories: [...new Set(output.antisemitism.categories)],
      explanation: output.antisemitism.explanation.trim(),
    },
  };
}
