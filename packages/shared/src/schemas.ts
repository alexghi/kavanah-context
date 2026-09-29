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

/** Categories follow the IHRA working definition as used by the hackathon's reference material. */
export const AntisemitismCategorySchema = z.enum([
  "conspiracy_or_control",
  "dehumanising_or_threatening",
  "holocaust_denial_or_distortion",
  "israel_related",
  "classic_tropes",
  "incitement_to_violence",
]);
export type AntisemitismCategory = z.infer<typeof AntisemitismCategorySchema>;

export const AntisemitismAssessmentSchema = z.object({
  assessment: z.enum(["not_detected", "possible", "likely"]),
  categories: z.array(AntisemitismCategorySchema),
  explanation: z.string(),
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
  meta: AnalysisMetaSchema,
});
export type AnalyzePostResponse = z.infer<typeof AnalyzePostResponseSchema>;

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
