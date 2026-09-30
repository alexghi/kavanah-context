import { describe, expect, it } from "vitest";
import {
  ANTISEMITISM_CATEGORIES,
  ANTISEMITISM_LEVELS,
  AntisemitismAssessmentSchema,
  AntisemitismCategorySchema,
  CONFIDENCE_LEVELS,
  CONTENT_LABELS,
  ConfidenceSchema,
  ContentLabelSchema,
  EVIDENCE_VERDICTS,
  EvidenceVerdictSchema,
  groupLabels,
  IHRA_DEFINITION_URL,
  MANIPULATION_GROUPS,
  MANIPULATION_LEVELS,
  MANIPULATION_TECHNIQUE_ORDER,
  MANIPULATION_TECHNIQUES,
  ManipulationLevelSchema,
  ManipulationTechniqueSchema,
  SCORE_BANDS,
  scoreBand,
  VERDICT_ORDER,
} from "@kavannah/shared";
import { verdictCounts } from "@/lib/labels";
import { TONE_CLASSES, TONE_ICON } from "@/lib/tone";
import { makeAnalysis } from "./helpers/analysis";

const nonEmpty = (s: string) => s.trim().length > 10;

describe("explanations cover every value the analysis can return", () => {
  it("content labels: one group, tone and definition each", () => {
    for (const label of ContentLabelSchema.options) {
      const info = CONTENT_LABELS[label];
      expect(info, label).toBeDefined();
      expect(["finding", "type"]).toContain(info.group);
      expect(nonEmpty(info.definition), label).toBe(true);
      if (info.group === "type") expect(info.tone, `${label} is descriptive, so neutral`).toBe("neutral");
    }
  });

  it("antisemitism levels and categories, confidence levels and verdicts", () => {
    for (const level of AntisemitismAssessmentSchema.shape.assessment.options) expect(nonEmpty(ANTISEMITISM_LEVELS[level].definition), level).toBe(true);
    for (const category of AntisemitismCategorySchema.options) expect(nonEmpty(ANTISEMITISM_CATEGORIES[category].definition), category).toBe(true);
    for (const confidence of ConfidenceSchema.options) expect(nonEmpty(CONFIDENCE_LEVELS[confidence].definition), confidence).toBe(true);
    for (const verdict of EvidenceVerdictSchema.options) expect(nonEmpty(EVIDENCE_VERDICTS[verdict].definition), verdict).toBe(true);
    expect([...VERDICT_ORDER].sort()).toEqual([...EvidenceVerdictSchema.options].sort());
  });

  it("manipulation techniques and levels are all defined and grouped", () => {
    for (const technique of ManipulationTechniqueSchema.options) {
      const info = MANIPULATION_TECHNIQUES[technique];
      expect(nonEmpty(info.definition), technique).toBe(true);
      expect(MANIPULATION_GROUPS[info.group], technique).toBeDefined();
    }
    expect([...MANIPULATION_TECHNIQUE_ORDER].sort()).toEqual([...ManipulationTechniqueSchema.options].sort());
    for (const level of ManipulationLevelSchema.options) expect(nonEmpty(MANIPULATION_LEVELS[level].definition), level).toBe(true);
  });

  it("every tone has classes and an icon", () => {
    for (const tone of ["critical", "warning", "caution", "positive", "neutral"] as const) {
      expect(TONE_CLASSES[tone].text).toMatch(/^text-\w+-strong$/);
      expect(TONE_ICON[tone]).toBeDefined();
    }
  });

  it("links the IHRA working definition", () => {
    expect(IHRA_DEFINITION_URL).toMatch(/^https:\/\/holocaustremembrance\.com\//);
  });
});

describe("score bands", () => {
  it("cover 0-100 without gaps or overlaps, each with a meaning", () => {
    const ascending = [...SCORE_BANDS].sort((a, b) => a.min - b.min);
    expect(ascending[0]!.min).toBe(0);
    expect(ascending.at(-1)!.max).toBe(100);
    for (let i = 1; i < ascending.length; i += 1) expect(ascending[i]!.min).toBe(ascending[i - 1]!.max + 1);
    for (const band of SCORE_BANDS) expect(nonEmpty(band.meaning), band.label).toBe(true);
  });

  it("maps boundary scores to the right band", () => {
    expect(scoreBand(24).label).toBe("No clear factual issue");
    expect(scoreBand(25).label).toBe("Some concerns");
    expect(scoreBand(49).label).toBe("Some concerns");
    expect(scoreBand(50).label).toBe("Potentially misleading");
    expect(scoreBand(74).tone).toBe("warning");
    expect(scoreBand(75).label).toBe("Likely misleading");
    expect(scoreBand(140).label).toBe("Likely misleading");
    expect(scoreBand(-3).label).toBe("No clear factual issue");
  });
});

describe("groupLabels", () => {
  it("puts findings first, most severe first, then kinds of post in the model's order", () => {
    const { findings, types } = groupLabels(["factual_claim", "misleading_framing", "benign", "opinion", "misinformation", "misinformation"]);
    expect(findings.map((f) => f.id)).toEqual(["misinformation", "misleading_framing", "benign"]);
    expect(types.map((t) => t.id)).toEqual(["factual_claim", "opinion"]);
  });

  it("keeps the model's order within the same severity", () => {
    const { findings } = groupLabels(["misinformation", "potentially_antisemitic"]);
    expect(findings.map((f) => f.id)).toEqual(["misinformation", "potentially_antisemitic"]);
  });

  it("handles posts with only one group", () => {
    expect(groupLabels(["opinion", "political_or_historical_argument"]).findings).toEqual([]);
    expect(groupLabels(["potentially_antisemitic"]).types).toEqual([]);
  });
});

describe("verdictCounts", () => {
  it("counts verdicts, most serious first", () => {
    const base = makeAnalysis().evidence[0]!;
    const evidence = [
      { ...base, claimId: "a", verdict: "supported" as const },
      { ...base, claimId: "b", verdict: "contradicted" as const },
      { ...base, claimId: "c", verdict: "contradicted" as const },
    ];
    expect(verdictCounts(evidence)).toEqual([
      { verdict: "contradicted", count: 2 },
      { verdict: "supported", count: 1 },
    ]);
    expect(verdictCounts([])).toEqual([]);
  });
});
