import type { PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult, SearchOutcome, SearchRequest, StructuredRequest } from "../lib/ai/provider.js";

/** Default, schema-valid outputs per stage. Tests override per stage (single result or a sequence). */
export const DEFAULT_OUTPUTS: Record<string, unknown> = {
  extractClaims: {
    claims: [
      { text: "The Moon is made of cheese.", type: "factual", checkworthy: true, reason: "specific and checkable" },
      { text: "Cheese is the best food.", type: "opinion", checkworthy: false, reason: "value judgment" },
    ],
  },
  classifyContent: {
    headline: "Likely misleading",
    labels: ["factual_claim", "misinformation"],
    explanation: "The post states a false fact.",
    confidence: "high",
    disinformationScore: 80,
    manipulationSignals: ["source_distortion"],
    antisemitism: { assessment: "not_detected", patterns: [], explanation: "No reference to Jews.", needsIhraReview: false },
    manipulation: {
      level: "present",
      summary: "A confident false claim with no source.",
      findings: [
        { technique: "False Authority", trigger: "The Moon is made of cheese.", explanation: "Stated as settled fact without any source.", confidence: "HIGH" },
        { technique: "not_a_technique", trigger: "x", explanation: "y", confidence: "low" },
        { technique: "false_authority", trigger: "duplicate", explanation: "dropped as a duplicate", confidence: "low" },
      ],
    },
  },
  assessIhra: {
    assessment: "likely",
    confidence: "high",
    summary: "IHRA-SUMMARY: the post uses a control trope.",
    findings: [
      {
        pattern: "conspiracy_or_control",
        trigger: "they control everything",
        ihraExample: "the myth of Jews controlling the media, economy, government or other societal institutions",
        whyItApplies: "It presents Jews as a hidden power.",
        strengthens: ["explicit wording"],
        weakens: [],
        facts: ["No such control exists."],
        interpretations: ["The wording is a dog whistle."],
        confidence: "high",
      },
    ],
    mechanism: "Scapegoating through a conspiracy frame.",
    historicalContext: "The control myth goes back to the Protocols forgery.",
    omittedDifferences: ["public institutions versus private control"],
    analogy: { present: false, historicalReferent: "", contemporaryReferent: "", mechanisms: [], mechanismExplanation: "", suppressesMaterialDifferences: false, conclusion: "" },
    tropeTransfers: [],
    semanticDisplacements: [],
    doubleStandard: { present: false, comparator: "", asymmetry: "" },
    communityNote2: { needed: true, text: "NOTE2: the control myth is false. https://example.org/moon", sourceIds: ["s1", "h1"] },
    sourceIds: ["s1", "h1", "zz9"],
  },
  assessEvidence: {
    assessments: [
      {
        claimId: "c1",
        verdict: "contradicted",
        summary: "Sources show the Moon is rock.",
        sources: [
          { id: "s1", whyItMatters: "Official composition data." },
          { id: "s99", whyItMatters: "This id does not exist and must be dropped." },
        ],
      },
    ],
  },
  compareAnalogy: {
    present: true,
    rows: [
      { dimension: "casualty_magnitude", historical: "about six million Jews murdered", contemporary: "figures disputed", difference: "scale differs", historicalBasis: "Sourced", contemporaryBasis: "unknown", sourceIds: ["h1"] },
      { dimension: "not_a_dimension", historical: "x", contemporary: "y", difference: "z", historicalBasis: "sourced", contemporaryBasis: "sourced", sourceIds: [] },
    ],
  },
  recommendEngagement: { recommendation: "do_not_engage", rationale: "ENGAGEMENT-RATIONALE: amplification risk." },
  recommendCommunityNote: { recommendation: "recommended", rationale: "NOTE-RATIONALE: a sourced note helps readers." },
  "draft:reply": { text: "The Moon is rock, not cheese. https://example.org/moon", sourceIds: ["s1"] },
  "draft:community_note": { text: "Lunar samples show the Moon is made of rock. https://example.org/moon", sourceIds: ["s1"] },
};

export const DEFAULT_SEARCH: SearchOutcome = {
  candidates: [
    { id: "s1", url: "https://example.org/moon", title: "Moon composition", publisher: "example.org", snippet: "The Moon is made of rock." },
    { id: "s2", url: "https://example.org/other", title: "Other page", publisher: "example.org" },
  ],
  notes: "s1 says the Moon is rock.",
  searches: 2,
  queries: ["moon composition"],
  toolErrors: [],
  resumed: 0,
};

type Scripted = ModelResult<unknown> | ModelResult<unknown>[];

export interface FakeProviderOptions {
  webSearch?: boolean;
  /** Per-stage scripted results; an array is consumed one call at a time (last value repeats). */
  structured?: Record<string, Scripted>;
  search?: ModelResult<SearchOutcome> | ModelResult<SearchOutcome>[];
  model?: string;
}

export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly model: string;
  readonly webSearchAvailable: boolean;
  readonly calls: Array<{ stage: string; system: string; user: string }> = [];
  readonly searchCalls: SearchRequest[] = [];
  private readonly scripted: Record<string, ModelResult<unknown>[]>;
  private readonly searchScript: ModelResult<SearchOutcome>[];

  constructor(options: FakeProviderOptions = {}) {
    this.model = options.model ?? "fake-model";
    this.webSearchAvailable = options.webSearch ?? true;
    this.scripted = {};
    for (const [stage, value] of Object.entries(options.structured ?? {})) {
      this.scripted[stage] = Array.isArray(value) ? [...value] : [value];
    }
    const search = options.search ?? { ok: true, value: DEFAULT_SEARCH };
    this.searchScript = Array.isArray(search) ? [...search] : [search];
  }

  async structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>> {
    this.calls.push({ stage: request.stage, system: request.system, user: request.user });
    const script = this.scripted[request.stage];
    if (script && script.length) {
      const next = script.length > 1 ? script.shift()! : script[0]!;
      if (!next.ok) return next;
      return { ok: true, value: request.schema.parse(next.value) };
    }
    const fallback = DEFAULT_OUTPUTS[request.stage];
    if (fallback === undefined) throw new Error(`FakeProvider: no default output for stage ${request.stage}`);
    return { ok: true, value: request.schema.parse(fallback) };
  }

  async search(request: SearchRequest): Promise<ModelResult<SearchOutcome>> {
    this.searchCalls.push(request);
    const next = this.searchScript.length > 1 ? this.searchScript.shift()! : this.searchScript[0]!;
    return next;
  }

  callsFor(stage: string): Array<{ stage: string; system: string; user: string }> {
    return this.calls.filter((c) => c.stage === stage);
  }
}

export const TEST_POST: PostContext = {
  platform: "x",
  url: "https://x.com/space_facts_lol/status/1900000000000000001",
  id: "1900000000000000001",
  text: "The Moon is made of cheese. Cheese is the best food.",
  author: { handle: "@space_facts_lol", displayName: "Space Facts" },
  language: "en",
};

/** Marks every URL as resolving except those containing "other". */
export async function fakeValidateUrl(url: string): Promise<{ url: string; ok: boolean; status?: number }> {
  return url.includes("other") ? { url, ok: false, status: 404 } : { url, ok: true, status: 200 };
}
