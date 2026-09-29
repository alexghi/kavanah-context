import type { AnalyzePostResponse, DraftKind, DraftResponse, PostContext } from "@kavannah/shared";

export const samplePost: PostContext = {
  platform: "x",
  url: "https://x.com/lemonde/status/1834567890123456789",
  id: "1834567890123456789",
  text: "Breaking: the French government announced a new plan.",
  author: { displayName: "Le Monde", handle: "@lemonde" },
  language: "en",
};

export function makeAnalysis(overrides: Partial<AnalyzePostResponse> = {}): AnalyzePostResponse {
  return {
    post: samplePost,
    classification: {
      headline: "Potentially misleading",
      labels: ["factual_claim", "misleading_framing"],
      explanation: "The post presents a preliminary figure as final.",
      confidence: "medium",
      disinformationScore: 62,
      antisemitism: { assessment: "not_detected", categories: [], explanation: "No antisemitic content detected." },
    },
    claims: [{ id: "c1", text: "The government announced a new plan.", type: "factual", checkworthy: true }],
    evidence: [
      {
        claimId: "c1",
        claim: "The government announced a new plan.",
        verdict: "partially_supported",
        summary: "A plan was announced, but the figures differ from the post.",
        sources: [
          {
            id: "s1",
            title: "Government unveils plan",
            url: "https://www.lemonde.fr/example",
            publisher: "Le Monde",
            whyItMatters: "Primary reporting on the announcement.",
            retrievedVia: "fixture",
            verified: true,
          },
        ],
      },
    ],
    engagement: { recommendation: "engage", rationale: "A short factual correction would add context." },
    communityNote: { recommendation: "recommended", rationale: "The figure is materially wrong." },
    meta: {
      version: 1,
      mode: "mock",
      model: "mock",
      fixtureId: "fx-1",
      analyzedAt: "2026-09-29T10:00:00.000Z",
      durationMs: 420,
      stages: [],
      warnings: [],
    },
    ...overrides,
  };
}

export function makeDraft(kind: DraftKind, text = "Generated draft text."): DraftResponse {
  return { kind, text, sources: [], warnings: [], meta: { mode: "mock", model: "mock", durationMs: 12 } };
}
