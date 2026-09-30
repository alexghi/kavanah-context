import {
  AnalogyMechanismSchema,
  ComparisonDimensionSchema,
  IhraPatternSchema,
  legacyCategoriesFor,
  StatementBasisSchema,
  type AnalogyMechanism,
  type Claim,
  type Classification,
  type ComparisonDimension,
  type ContentLabel,
  type EvidenceItem,
  type IhraAssessment,
  type IhraPattern,
  type PostContext,
  type Source,
  type StatementBasis,
} from "@kavannah/shared";
import type { CandidateSource, ModelProvider, ModelResult } from "../../ai/provider.js";
import { enumValue } from "../enums.js";
import { assessIhraPrompt, compareAnalogyPrompt } from "../prompts.js";
import { AnalogyRowsOutputSchema, IhraOutputSchema, type AnalogyRowsOutput, type IhraOutput } from "../schemas.js";

/** The IHRA output is long (findings, chains, a note): give it room. */
export const IHRA_MAX_TOKENS = 10000;
export const ANALOGY_MAX_TOKENS = 6000;

/** Stage 5c: the full IHRA assessment (structured). Sources are chosen by id only. */
export function assessIhra(
  provider: ModelProvider,
  post: PostContext,
  classification: Classification,
  claims: Claim[],
  evidence: EvidenceItem[],
  candidates: CandidateSource[],
  notes: string,
): Promise<ModelResult<IhraOutput>> {
  return provider.structured({
    stage: "assessIhra",
    system: assessIhraPrompt.system,
    user: assessIhraPrompt.user(post, classification, claims, evidence, candidates, notes),
    schema: IhraOutputSchema,
    maxTokens: IHRA_MAX_TOKENS,
  });
}

/** Stage 5d: the point-by-point comparison of a Nazi / Holocaust analogy, in parallel with 5c. */
export function compareAnalogy(
  provider: ModelProvider,
  post: PostContext,
  classification: Classification,
  claims: Claim[],
  evidence: EvidenceItem[],
  candidates: CandidateSource[],
  notes: string,
): Promise<ModelResult<AnalogyRowsOutput>> {
  return provider.structured({
    stage: "compareAnalogy",
    system: compareAnalogyPrompt.system,
    user: compareAnalogyPrompt.user(post, classification, claims, evidence, candidates, notes),
    schema: AnalogyRowsOutputSchema,
    maxTokens: ANALOGY_MAX_TOKENS,
  });
}

const clean = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);

const patternOf = (raw: string): IhraPattern | null => enumValue(IhraPatternSchema.options, raw);
const dimensionOf = (raw: string): ComparisonDimension | null => enumValue(ComparisonDimensionSchema.options, raw);
const mechanismOf = (raw: string): AnalogyMechanism | null => enumValue(AnalogyMechanismSchema.options, raw);
const basisOf = (raw: string): StatementBasis => enumValue(StatementBasisSchema.options, raw) ?? "unknown";

/**
 * Turns the model output into the shared IhraAssessment. Source ids are resolved against the
 * allowed sources (IHRA research + evidence); unknown ids are dropped and reported, so no source
 * can appear that the search did not return.
 */
export function buildIhraAssessment(output: IhraOutput, comparison: AnalogyRowsOutput | null, allowed: Map<string, Source>): { ihra: IhraAssessment; droppedSourceIds: string[] } {
  const dropped = new Set<string>();
  const used: Source[] = [];
  const resolve = (ids: string[]): Source[] => {
    const out: Source[] = [];
    for (const raw of ids) {
      const id = raw.trim();
      const source = allowed.get(id);
      if (!source) {
        if (id) dropped.add(id);
        continue;
      }
      if (!out.some((s) => s.id === id)) out.push(source);
      if (!used.some((s) => s.id === id)) used.push(source);
    }
    return out;
  };

  resolve(output.sourceIds);
  const a = output.analogy;
  const rows = (comparison?.present ? comparison.rows : []).flatMap((row) => {
    const dimension = dimensionOf(row.dimension);
    if (!dimension) return [];
    return [
      {
        dimension,
        historical: row.historical.trim(),
        contemporary: row.contemporary.trim(),
        difference: row.difference.trim(),
        historicalBasis: basisOf(row.historicalBasis),
        contemporaryBasis: basisOf(row.contemporaryBasis),
        sourceIds: resolve(row.sourceIds).map((s) => s.id),
      },
    ];
  });
  const analogy =
    a.present
      ? {
          historicalReferent: a.historicalReferent.trim(),
          contemporaryReferent: a.contemporaryReferent.trim(),
          mechanisms: [...new Set(a.mechanisms.map(mechanismOf).filter((m): m is AnalogyMechanism => m !== null))],
          mechanismExplanation: a.mechanismExplanation.trim(),
          rows,
          suppressesMaterialDifferences: a.suppressesMaterialDifferences,
          conclusion: a.conclusion.trim(),
        }
      : undefined;

  const note = output.communityNote2;
  const communityNote2 = note.needed && note.text.trim() ? { text: note.text.trim(), sources: resolve(note.sourceIds) } : undefined;

  const ihra: IhraAssessment = {
    assessment: output.assessment,
    confidence: output.confidence,
    summary: output.summary.trim(),
    findings: output.findings.flatMap((f) => {
      const pattern = patternOf(f.pattern);
      if (!pattern) return [];
      return [
        {
          pattern,
          trigger: f.trigger.trim(),
          ihraExample: f.ihraExample.trim(),
          whyItApplies: f.whyItApplies.trim(),
          strengthens: clean(f.strengthens),
          weakens: clean(f.weakens),
          facts: clean(f.facts),
          interpretations: clean(f.interpretations),
          confidence: f.confidence,
        },
      ];
    }),
    mechanism: output.mechanism.trim(),
    historicalContext: output.historicalContext.trim(),
    omittedDifferences: clean(output.omittedDifferences),
    tropeTransfers: output.tropeTransfers.map((t) => ({
      originalTrope: t.originalTrope.trim(),
      substitution: t.substitution.trim(),
      contemporaryTarget: t.contemporaryTarget.trim(),
      stereotypePreserved: t.stereotypePreserved,
      explanation: t.explanation.trim(),
    })),
    semanticDisplacements: output.semanticDisplacements.map((d) => ({
      historicalReferent: d.historicalReferent.trim(),
      operation: d.operation.trim(),
      newReferent: d.newReferent.trim(),
      consequence: d.consequence.trim(),
    })),
    sources: used,
  };
  if (analogy) ihra.analogy = analogy;
  if (output.doubleStandard.present && output.doubleStandard.comparator.trim()) {
    ihra.doubleStandard = { comparator: output.doubleStandard.comparator.trim(), asymmetry: output.doubleStandard.asymmetry.trim() };
  }
  if (communityNote2) ihra.communityNote2 = communityNote2;
  return { ihra, droppedSourceIds: [...dropped] };
}

/**
 * The full review is more careful than the screening, so its result replaces the screening's
 * antisemitism assessment, and the "Potentially antisemitic" label follows it.
 */
export function reconcileClassification(classification: Classification, ihra: IhraAssessment): Classification {
  const patterns = [...new Set(ihra.findings.map((f) => f.pattern))];
  let labels: ContentLabel[] = [...classification.labels];
  if (ihra.assessment === "likely" && !labels.includes("potentially_antisemitic")) labels = ["potentially_antisemitic", ...labels];
  if (ihra.assessment === "not_detected") labels = labels.filter((l) => l !== "potentially_antisemitic");
  if (labels.length === 0) labels = ["benign"];
  return {
    ...classification,
    labels,
    antisemitism: {
      assessment: ihra.assessment,
      categories: legacyCategoriesFor(patterns),
      explanation: ihra.summary || classification.antisemitism.explanation,
      patterns,
    },
  };
}
