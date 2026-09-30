import { z } from "zod";

/**
 * Kavannah shared contract.
 *
 * Everything the extension and the backend exchange is defined here, once, as Zod
 * schemas. Types are inferred from the schemas so both sides stay in sync.
 *
 * Product principle encoded in the shape: `engagement` and `communityNote` are two
 * INDEPENDENT recommendations. Neither is derived from the other.
 */

// ---------------------------------------------------------------------------
// Post context (what the extension extracts from the X DOM)
// ---------------------------------------------------------------------------

export const PostAuthorSchema = z.object({
  /** e.g. "@someone" (with the @) */
  handle: z.string().optional(),
  displayName: z.string().optional(),
});
export type PostAuthor = z.infer<typeof PostAuthorSchema>;

export const PostContextSchema = z.object({
  platform: z.literal("x"),
  /** Canonical post URL, e.g. https://x.com/user/status/123 */
  url: z.string().min(1),
  /** Numeric post id when it could be parsed from the URL */
  id: z.string().optional(),
  text: z.string().min(1),
  author: PostAuthorSchema.optional(),
  /** BCP-47 language tag if X exposed one (lang attribute) */
  language: z.string().optional(),
  /** ISO timestamp if available */
  postedAt: z.string().optional(),
  /** Basic contextual information, only when cheaply available */
  context: z
    .object({
      quotedPost: z.object({ text: z.string(), author: z.string().optional() }).optional(),
      /** handle(s) this post replies to */
      replyingTo: z.array(z.string()).optional(),
      hasMedia: z.boolean().optional(),
      links: z.array(z.string()).optional(),
    })
    .optional(),
});
export type PostContext = z.infer<typeof PostContextSchema>;

// ---------------------------------------------------------------------------
// Analysis building blocks
// ---------------------------------------------------------------------------

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ClaimTypeSchema = z.enum([
  "factual",
  "opinion",
  "political_or_historical_argument",
  "unverifiable",
  "prediction",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  /** The claim as stated or closely paraphrased. Never a fabricated quotation. */
  text: z.string(),
  type: ClaimTypeSchema,
  /** Worth checking against evidence (factual, specific, consequential) */
  checkworthy: z.boolean(),
  reason: z.string().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ContentLabelSchema = z.enum([
  "factual_claim",
  "opinion",
  "political_or_historical_argument",
  "potentially_antisemitic",
  "misinformation",
  "misleading_framing",
  "unverifiable_claim",
  "benign",
]);
export type ContentLabel = z.infer<typeof ContentLabelSchema>;

/**
 * Summary categories of the first release. Still sent (derived from `patterns`, see
 * legacyCategoriesFor) so extension builds that predate the IHRA patterns keep validating.
 */
export const AntisemitismCategorySchema = z.enum([
  "conspiracy_or_control",
  "dehumanising_or_threatening",
  "holocaust_denial_or_distortion",
  "israel_related",
  "classic_tropes",
  "incitement_to_violence",
]);
export type AntisemitismCategory = z.infer<typeof AntisemitismCategorySchema>;

/**
 * The patterns the IHRA framework checks systematically (sections 1-9 of the framework) plus
 * the IHRA example of calls for violence. Definitions: explain.ts (IHRA_PATTERNS).
 */
export const IhraPatternSchema = z.enum([
  "collective_blame",
  "conspiracy_or_control",
  "demonization_or_dehumanization",
  "holocaust_denial_or_distortion",
  "nazi_analogy",
  "double_standards",
  "denial_of_self_determination",
  "classic_tropes_applied_to_israel",
  "semantic_displacement",
  "incitement_to_violence",
]);
export type IhraPattern = z.infer<typeof IhraPatternSchema>;

const LEGACY_CATEGORIES: Record<IhraPattern, AntisemitismCategory[]> = {
  collective_blame: ["israel_related"],
  conspiracy_or_control: ["conspiracy_or_control"],
  demonization_or_dehumanization: ["dehumanising_or_threatening"],
  holocaust_denial_or_distortion: ["holocaust_denial_or_distortion"],
  nazi_analogy: ["israel_related"],
  double_standards: ["israel_related"],
  denial_of_self_determination: ["israel_related"],
  classic_tropes_applied_to_israel: ["classic_tropes", "israel_related"],
  semantic_displacement: ["holocaust_denial_or_distortion"],
  incitement_to_violence: ["incitement_to_violence"],
};

/** The first-release categories that correspond to a set of IHRA patterns (deduplicated, in order). */
export function legacyCategoriesFor(patterns: readonly IhraPattern[]): AntisemitismCategory[] {
  return [...new Set(patterns.flatMap((pattern) => LEGACY_CATEGORIES[pattern] ?? []))];
}

export const AntisemitismAssessmentSchema = z.object({
  assessment: z.enum(["not_detected", "possible", "likely"]),
  /** First-release summary categories (derived from `patterns` on current servers). */
  categories: z.array(AntisemitismCategorySchema),
  explanation: z.string(),
  /** IHRA patterns found. Absent on results from servers that predate the IHRA framework. */
  patterns: z.array(IhraPatternSchema).optional(),
});
export type AntisemitismAssessment = z.infer<typeof AntisemitismAssessmentSchema>;

export const ClassificationSchema = z.object({
  /** Short human headline, e.g. "Potentially misleading", "No clear factual issue identified" */
  headline: z.string(),
  labels: z.array(ContentLabelSchema).min(1),
  explanation: z.string(),
  /** How confident the AI is in this assessment. Independent from the score. */
  confidence: ConfidenceSchema,
  /**
   * Indicative AI assessment (0-100) of how misleading the post's factual content is.
   * 0 = no factual issue found, 100 = clearly false or misleading.
   * NOT a probability and NOT "percent of the post that is false".
   */
  disinformationScore: z.number().int().min(0).max(100),
  antisemitism: AntisemitismAssessmentSchema,
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  publisher: z.string().optional(),
  /** One sentence: why this source is relevant to the claim */
  whyItMatters: z.string().optional(),
  /** Short excerpt actually retrieved from the source (never invented) */
  snippet: z.string().optional(),
  retrievedVia: z.enum(["web_search", "model_knowledge", "fixture"]),
  /** True when the backend confirmed the URL resolves */
  verified: z.boolean(),
});
export type Source = z.infer<typeof SourceSchema>;

export const EvidenceVerdictSchema = z.enum([
  "supported",
  "contradicted",
  "partially_supported",
  "insufficient_evidence",
  "not_a_factual_claim",
]);
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

export const EvidenceItemSchema = z.object({
  claimId: z.string(),
  claim: z.string(),
  verdict: EvidenceVerdictSchema,
  /** Plain-language summary. Must say explicitly when evidence is unavailable. */
  summary: z.string(),
  sources: z.array(SourceSchema),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ---------------------------------------------------------------------------
// IHRA antisemitism assessment (dedicated stage, runs when the screening flags a post)
// ---------------------------------------------------------------------------

/** How a Nazi / Holocaust analogy works. Not interchangeable: the assessment names each one present. */
export const AnalogyMechanismSchema = z.enum([
  "holocaust_analogy",
  "nazi_comparison",
  "symbolic_substitution",
  "historical_resemanticization",
  "false_equivalence",
  "holocaust_distortion",
]);
export type AnalogyMechanism = z.infer<typeof AnalogyMechanismSchema>;

/** The dimensions of the structured comparison the framework requires for an analogy. */
export const ComparisonDimensionSchema = z.enum([
  "casualty_magnitude",
  "proportion_affected",
  "documented_objectives",
  "targeting_criteria",
  "institutional_structures",
  "methods_of_violence",
  "detention_and_deportation",
  "chronology_and_duration",
  "territorial_scope",
  "legal_and_military_context",
  "historical_context",
]);
export type ComparisonDimension = z.infer<typeof ComparisonDimensionSchema>;

/** Fact versus interpretation, per statement. */
export const StatementBasisSchema = z.enum(["sourced", "established", "interpretation", "unknown"]);
export type StatementBasis = z.infer<typeof StatementBasisSchema>;

/** One pattern found, with the framework's context test. */
export const IhraFindingSchema = z.object({
  pattern: IhraPatternSchema,
  /** The exact element of the post that triggers the finding (quoted when possible) */
  trigger: z.string(),
  /** The relevant IHRA example */
  ihraExample: z.string(),
  whyItApplies: z.string(),
  /** Contextual evidence that strengthens / weakens the classification */
  strengthens: z.array(z.string()),
  weakens: z.array(z.string()),
  facts: z.array(z.string()),
  interpretations: z.array(z.string()),
  confidence: ConfidenceSchema,
});
export type IhraFinding = z.infer<typeof IhraFindingSchema>;

export const AnalogyComparisonRowSchema = z.object({
  dimension: ComparisonDimensionSchema,
  historical: z.string(),
  contemporary: z.string(),
  /** The material difference, or why the two are comparable on this dimension */
  difference: z.string(),
  /** Fact versus interpretation, for each side */
  historicalBasis: StatementBasisSchema,
  contemporaryBasis: StatementBasisSchema,
  /** ids into IhraAssessment.sources */
  sourceIds: z.array(z.string()),
});
export type AnalogyComparisonRow = z.infer<typeof AnalogyComparisonRowSchema>;

export const AnalogyComparisonSchema = z.object({
  historicalReferent: z.string(),
  contemporaryReferent: z.string(),
  mechanisms: z.array(AnalogyMechanismSchema),
  mechanismExplanation: z.string(),
  rows: z.array(AnalogyComparisonRowSchema),
  /** Whether the analogy suppresses differences needed to understand the two events */
  suppressesMaterialDifferences: z.boolean(),
  conclusion: z.string(),
});
export type AnalogyComparison = z.infer<typeof AnalogyComparisonSchema>;

/** ORIGINAL ANTISEMITIC TROPE → LEXICAL / SYMBOLIC SUBSTITUTION → CONTEMPORARY TARGET */
export const TropeTransferSchema = z.object({
  originalTrope: z.string(),
  substitution: z.string(),
  contemporaryTarget: z.string(),
  stereotypePreserved: z.boolean(),
  explanation: z.string(),
});
export type TropeTransfer = z.infer<typeof TropeTransferSchema>;

/** HISTORICAL REFERENT → SEMANTIC OPERATION → NEW REFERENT → INFORMATIONAL CONSEQUENCE */
export const SemanticDisplacementSchema = z.object({
  historicalReferent: z.string(),
  operation: z.string(),
  newReferent: z.string(),
  consequence: z.string(),
});
export type SemanticDisplacement = z.infer<typeof SemanticDisplacementSchema>;

export const DoubleStandardSchema = z.object({
  /** The comparable state or situation */
  comparator: z.string(),
  /** The demonstrated asymmetry */
  asymmetry: z.string(),
});
export type DoubleStandard = z.infer<typeof DoubleStandardSchema>;

/** Extended, evidence-based explanation (longer than an X Community Note). Never posted automatically. */
export const CommunityNote2Schema = z.object({
  text: z.string(),
  sources: z.array(SourceSchema),
});
export type CommunityNote2 = z.infer<typeof CommunityNote2Schema>;

export const IhraAssessmentSchema = z.object({
  assessment: z.enum(["not_detected", "possible", "likely"]),
  confidence: ConfidenceSchema,
  /** "Assessment": the conclusion in a few sentences */
  summary: z.string(),
  /** "Relevant IHRA pattern" and "Evidence in the post", one entry per pattern found */
  findings: z.array(IhraFindingSchema),
  /** "Semantic / narrative mechanism" */
  mechanism: z.string(),
  /** "Historical or factual context" */
  historicalContext: z.string(),
  /** "Material differences omitted" */
  omittedDifferences: z.array(z.string()),
  analogy: AnalogyComparisonSchema.optional(),
  tropeTransfers: z.array(TropeTransferSchema),
  semanticDisplacements: z.array(SemanticDisplacementSchema),
  doubleStandard: DoubleStandardSchema.optional(),
  communityNote2: CommunityNote2Schema.optional(),
  /** Every source the assessment relies on (web-search results or fixtures, never invented) */
  sources: z.array(SourceSchema),
});
export type IhraAssessment = z.infer<typeof IhraAssessmentSchema>;

// ---------------------------------------------------------------------------
// The two independent recommendations
// ---------------------------------------------------------------------------

export const EngagementRecommendationSchema = z.enum(["engage", "do_not_engage", "uncertain"]);
export type EngagementRecommendation = z.infer<typeof EngagementRecommendationSchema>;

export const EngagementSchema = z.object({
  recommendation: EngagementRecommendationSchema,
  rationale: z.string(),
  /** Optional pre-generated draft; usually generated on demand via the draft endpoint */
  draftReply: z.string().optional(),
});
export type Engagement = z.infer<typeof EngagementSchema>;

export const CommunityNoteRecommendationSchema = z.enum(["recommended", "not_recommended", "uncertain"]);
export type CommunityNoteRecommendation = z.infer<typeof CommunityNoteRecommendationSchema>;

export const CommunityNoteSchema = z.object({
  recommendation: CommunityNoteRecommendationSchema,
  rationale: z.string(),
  /** Optional pre-generated draft; usually generated on demand via the draft endpoint */
  draft: z.string().optional(),
});
export type CommunityNote = z.infer<typeof CommunityNoteSchema>;

// ---------------------------------------------------------------------------
// Full analysis
// ---------------------------------------------------------------------------

export const AnalysisModeSchema = z.enum(["live", "mock"]);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;

export const StageReportSchema = z.object({
  name: z.string(),
  ms: z.number(),
  ok: z.boolean(),
  note: z.string().optional(),
});
export type StageReport = z.infer<typeof StageReportSchema>;

export const AnalysisMetaSchema = z.object({
  version: z.literal(1),
  mode: AnalysisModeSchema,
  model: z.string().optional(),
  /** Set when a mock fixture answered the request */
  fixtureId: z.string().optional(),
  analyzedAt: z.string(),
  durationMs: z.number(),
  stages: z.array(StageReportSchema),
  /** Things the user should know, e.g. "Live source retrieval was unavailable." */
  warnings: z.array(z.string()),
});
export type AnalysisMeta = z.infer<typeof AnalysisMetaSchema>;

export const AnalyzePostResponseSchema = z.object({
  post: PostContextSchema,
  classification: ClassificationSchema,
  claims: z.array(ClaimSchema),
  evidence: z.array(EvidenceItemSchema),
  engagement: EngagementSchema,
  communityNote: CommunityNoteSchema,
  /** Full IHRA assessment. Present only when the screening flagged the post for review. */
  ihra: IhraAssessmentSchema.optional(),
  meta: AnalysisMetaSchema,
});
export type AnalyzePostResponse = z.infer<typeof AnalyzePostResponseSchema>;

// ---------------------------------------------------------------------------
// Progressive delivery (NDJSON stream from POST /api/analyze with Accept: application/x-ndjson)
// ---------------------------------------------------------------------------

export const AnalysisPhaseSchema = z.enum(["classifying", "checking_evidence", "reviewing_ihra", "recommending", "done"]);
export type AnalysisPhase = z.infer<typeof AnalysisPhaseSchema>;

/** What the server has so far. Parts appear as their stages finish; `analysis` in the final event has everything. */
export const AnalysisProgressSchema = z.object({
  phase: AnalysisPhaseSchema,
  post: PostContextSchema,
  classification: ClassificationSchema.optional(),
  claims: z.array(ClaimSchema).optional(),
  evidence: z.array(EvidenceItemSchema).optional(),
  /** The full IHRA review is running (or queued) for this post; `ihra` arrives later. */
  ihraPending: z.boolean(),
  ihra: IhraAssessmentSchema.optional(),
  stages: z.array(StageReportSchema),
  warnings: z.array(z.string()),
  elapsedMs: z.number(),
});
export type AnalysisProgress = z.infer<typeof AnalysisProgressSchema>;

export const AnalysisEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), progress: AnalysisProgressSchema }),
  z.object({ type: z.literal("result"), analysis: AnalyzePostResponseSchema }),
  z.object({ type: z.literal("error"), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type AnalysisEvent = z.infer<typeof AnalysisEventSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const AnalysisPreferencesSchema = z.object({
  /** Domains the user prefers as sources. Influences selection only, never overrides evidence. */
  trustedDomains: z.array(z.string()).optional(),
  /** Preferred language for explanations and drafts (BCP-47). Defaults to the post language. */
  language: z.string().optional(),
});
export type AnalysisPreferences = z.infer<typeof AnalysisPreferencesSchema>;

export const AnalyzeOptionsSchema = z.object({
  /** Force the mock provider for this request */
  mock: z.boolean().optional(),
  /** Bypass the server-side cache */
  refresh: z.boolean().optional(),
  preferences: AnalysisPreferencesSchema.optional(),
});
export type AnalyzeOptions = z.infer<typeof AnalyzeOptionsSchema>;

export const AnalyzePostRequestSchema = z.object({
  post: PostContextSchema,
  options: AnalyzeOptionsSchema.optional(),
});
export type AnalyzePostRequest = z.infer<typeof AnalyzePostRequestSchema>;

export const DraftKindSchema = z.enum(["reply", "community_note"]);
export type DraftKind = z.infer<typeof DraftKindSchema>;

export const DraftRequestSchema = z.object({
  post: PostContextSchema,
  analysis: AnalyzePostResponseSchema,
  kind: DraftKindSchema,
  options: AnalyzeOptionsSchema.optional(),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

export const DraftResponseSchema = z.object({
  kind: DraftKindSchema,
  /** Editable text. Never published automatically. */
  text: z.string(),
  /** Sources referenced in the text (subset of the analysis evidence sources) */
  sources: z.array(SourceSchema),
  warnings: z.array(z.string()),
  meta: z.object({ mode: AnalysisModeSchema, model: z.string().optional(), durationMs: z.number() }),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;

/** Access-key status as seen by the caller of GET /api/health. */
export const HealthAuthSchema = z.object({
  /** The server was started with KAVANNAH_ACCESS_KEYS and protects /api/analyze and /api/draft */
  required: z.boolean(),
  /** none = no key sent (or none needed); valid/invalid = the sent key was checked */
  key: z.enum(["none", "valid", "invalid"]),
  /** The person the accepted key belongs to */
  name: z.string().optional(),
});
export type HealthAuth = z.infer<typeof HealthAuthSchema>;

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  mode: AnalysisModeSchema,
  model: z.string(),
  webSearch: z.boolean(),
  version: z.string(),
  auth: HealthAuthSchema.optional(),
  /** Which models run which tier (live mode). */
  models: z
    .object({
      judge: z.string(),
      fast: z.string().optional(),
      search: z.string().optional(),
      failover: z.string().optional(),
    })
    .optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Demo fixtures (mock mode)
// ---------------------------------------------------------------------------

export const FixtureSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Which representative scenario this covers (see the product brief, section 16) */
  scenario: z.string(),
  post: PostContextSchema,
  analysis: AnalyzePostResponseSchema,
  drafts: z.object({
    reply: z.string().optional(),
    community_note: z.string().optional(),
  }),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const FixturesResponseSchema = z.object({
  fixtures: z.array(
    z.object({ id: z.string(), title: z.string(), scenario: z.string(), post: PostContextSchema }),
  ),
});
export type FixturesResponse = z.infer<typeof FixturesResponseSchema>;
