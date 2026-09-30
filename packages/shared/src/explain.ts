import type {
  AnalogyMechanism,
  AntisemitismAssessment,
  AntisemitismCategory,
  ComparisonDimension,
  Confidence,
  ContentLabel,
  EvidenceVerdict,
  IhraPattern,
  StatementBasis,
} from "./schemas";

/**
 * Plain-language explanations for every category the extension shows: content labels,
 * antisemitism levels and categories, AI confidence and evidence verdicts. The UI shows the
 * definition next to each tag, and the full set in "How to read this analysis".
 *
 * The wording mirrors the instructions the analysis prompts give the model
 * (apps/server/src/lib/analysis/prompts.ts). Change both together.
 */

/** Severity colour family. `neutral` is for descriptive, non-judgemental values. */
export type Tone = "critical" | "warning" | "caution" | "positive" | "neutral";

export interface Explained {
  label: string;
  tone: Tone;
  definition: string;
}

/** The IHRA working definition of antisemitism, the baseline of the antisemitism assessment. */
export const IHRA_DEFINITION_URL = "https://holocaustremembrance.com/resources/working-definition-antisemitism";

// ---------------------------------------------------------------------------
// Content labels
// ---------------------------------------------------------------------------

/**
 * Labels answer two different questions, so the UI keeps them apart:
 * - finding: what the analysis found (a problem, or that there is none);
 * - type: what kind of post it is (descriptive, never a judgement).
 */
export type LabelGroup = "finding" | "type";

export interface LabelExplained extends Explained {
  group: LabelGroup;
}

export const LABEL_GROUPS: Record<LabelGroup, { title: string; description: string }> = {
  finding: {
    title: "What was found",
    description: "Problems the analysis identified in the post, or that it found none.",
  },
  type: {
    title: "Kind of post",
    description: "What the post does. These labels describe it; they are not judgements.",
  },
};

export const CONTENT_LABELS: Record<ContentLabel, LabelExplained> = {
  potentially_antisemitic: {
    label: "Potentially antisemitic",
    group: "finding",
    tone: "critical",
    definition:
      "The post itself uses antisemitic content, judged against the IHRA working definition. Quoting antisemitism to condemn or document it does not count.",
  },
  misinformation: {
    label: "Misinformation",
    group: "finding",
    tone: "critical",
    definition: "A factual claim in the post is false, or contradicted by well-established evidence.",
  },
  misleading_framing: {
    label: "Misleading framing",
    group: "finding",
    tone: "caution",
    definition:
      "The facts may be accurate, but the way they are selected, compared or framed leads readers to a false conclusion.",
  },
  unverifiable_claim: {
    label: "Unverifiable claim",
    group: "finding",
    tone: "caution",
    definition: "The post's central claim can't be checked with public sources, for example an anonymous insider's account.",
  },
  benign: {
    label: "Benign",
    group: "finding",
    tone: "positive",
    definition: "Nothing misleading or harmful was identified.",
  },
  factual_claim: {
    label: "Factual claim",
    group: "type",
    tone: "neutral",
    definition: "The post makes at least one specific statement about the world that can be checked.",
  },
  opinion: {
    label: "Opinion",
    group: "type",
    tone: "neutral",
    definition: "The post is mainly a value judgement or preference, which can't be fact-checked.",
  },
  political_or_historical_argument: {
    label: "Political or historical argument",
    group: "type",
    tone: "neutral",
    definition: "The post argues an interpretation of politics or history that doesn't reduce to a single checkable fact.",
  },
};

const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, caution: 2, positive: 3, neutral: 4 };

export interface GroupedLabel extends LabelExplained {
  id: ContentLabel;
}

/**
 * Splits labels into findings (most severe first) and descriptive labels. Within the same
 * severity the model's order is kept; duplicates are dropped.
 */
export function groupLabels(labels: readonly ContentLabel[]): { findings: GroupedLabel[]; types: GroupedLabel[] } {
  const unique = [...new Set(labels)].filter((id) => id in CONTENT_LABELS);
  const items = unique.map((id, index) => ({ ...CONTENT_LABELS[id], id, index }));
  const bySeverity = (a: (typeof items)[number], b: (typeof items)[number]) =>
    TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.index - b.index;
  const strip = ({ index: _index, ...rest }: (typeof items)[number]): GroupedLabel => rest;
  return {
    findings: items.filter((item) => item.group === "finding").sort(bySeverity).map(strip),
    types: items.filter((item) => item.group === "type").sort((a, b) => a.index - b.index).map(strip),
  };
}

// ---------------------------------------------------------------------------
// Antisemitism
// ---------------------------------------------------------------------------

export type AntisemitismLevel = AntisemitismAssessment["assessment"];

export const ANTISEMITISM_LEVELS: Record<AntisemitismLevel, Explained> = {
  likely: {
    label: "Likely",
    tone: "critical",
    definition: "The post very probably uses antisemitic content.",
  },
  possible: {
    label: "Possible",
    tone: "caution",
    definition:
      "Parts of the post could be antisemitic, but the meaning depends on context the analysis can't see, such as irony, an image or a quoted post.",
  },
  not_detected: {
    label: "Not detected",
    tone: "neutral",
    definition: "No antisemitic content was identified in the post.",
  },
};

export const ANTISEMITISM_CATEGORIES: Record<AntisemitismCategory, { label: string; definition: string }> = {
  conspiracy_or_control: {
    label: "Conspiracy or control tropes",
    definition:
      "Portrays Jews as collectively controlling world events, governments, media or finance, for example Rothschild or Soros control myths, or “(((echo)))” markers that single out Jews.",
  },
  dehumanising_or_threatening: {
    label: "Dehumanising or threatening language",
    definition: "Slurs, comparisons to vermin, disease or parasites, or threats aimed at people for being Jewish.",
  },
  holocaust_denial_or_distortion: {
    label: "Holocaust denial or distortion",
    definition:
      "Denies, minimises or distorts the Holocaust, blames Jews for it, or shifts responsibility away from Nazi Germany and its collaborators.",
  },
  israel_related: {
    label: "Israel-related antisemitism",
    definition:
      "Crosses from criticism of Israeli policy into antisemitism, for example holding Jews collectively responsible for Israel's actions, dual-loyalty accusations, or comparing Israeli policy to that of the Nazis.",
  },
  classic_tropes: {
    label: "Classic antisemitic tropes",
    definition: "Blood libel, ritual murder, the “Christ-killers” accusation and other religious demonisation.",
  },
  incitement_to_violence: {
    label: "Incitement to violence",
    definition: "Calls for, glorifies or supports violence against Jews.",
  },
};

/**
 * What the antisemitism check deliberately does not count. Shown after "Judged against the IHRA
 * working definition of antisemitism." (with a link to IHRA_DEFINITION_URL).
 */
export const ANTISEMITISM_EXCLUSIONS =
  "Criticism of Israel like that levelled against any other country is not antisemitic, and neither is quoting antisemitism to condemn or document it.";

export const ANTISEMITISM_NOT_FALSE =
  "Antisemitic is not the same as false: a slur with no factual claim is antisemitic, but it is not misinformation and gets a low disinformation score.";

// ---------------------------------------------------------------------------
// IHRA framework: patterns, analogy mechanisms, comparison
// ---------------------------------------------------------------------------

/**
 * The IHRA framework's patterns, numbered as in the framework (1-9); calls for violence is the
 * IHRA example the framework's list leaves implicit. Wording follows the framework text.
 */
export const IHRA_PATTERNS: Record<IhraPattern, { number: number | null; label: string; definition: string }> = {
  collective_blame: {
    number: 1,
    label: "Jews blamed as a collective",
    definition:
      "Blames Jews collectively for real or alleged actions, attributes Israel's actions to Jews as a people, or holds Jewish individuals, institutions or communities responsible for what the Israeli state does.",
  },
  conspiracy_or_control: {
    number: 2,
    label: "Conspiracy or power stereotype",
    definition:
      "Portrays Jews as secretly controlling governments, media, finance, institutions or public opinion, or as a coordinated hidden power.",
  },
  demonization_or_dehumanization: {
    number: 3,
    label: "Demonization or dehumanization",
    definition:
      "Makes mendacious, dehumanizing, demonizing or stereotypical claims about Jews, or reuses classic antisemitic imagery such as blood-libel narratives.",
  },
  holocaust_denial_or_distortion: {
    number: 4,
    label: "Holocaust denial or distortion",
    definition:
      "Denies the Holocaust or minimizes its scale, distorts its mechanisms or the Nazis' intent to exterminate, or claims Jews or Israel invented or exaggerated it.",
  },
  nazi_analogy: {
    number: 5,
    label: "Nazi or Holocaust analogy about Israel",
    definition:
      "Compares Israeli policy or Israelis to Nazis, Hitler, Auschwitz or the Final Solution, or casts Palestinians or another group in the role of Holocaust victims.",
  },
  double_standards: {
    number: 6,
    label: "Double standard applied to Israel",
    definition:
      "Holds Israel to a standard that is demonstrably not applied to comparable states or situations. Strong criticism on its own is not a double standard.",
  },
  denial_of_self_determination: {
    number: 7,
    label: "Denial of Jewish self-determination",
    definition:
      "Denies Jewish people collective rights, or presents Israel's existence itself as illegitimate. Criticising a government, borders, settlements, military operations or policies is not this.",
  },
  classic_tropes_applied_to_israel: {
    number: 8,
    label: "Classic trope applied to Israel",
    definition:
      "Moves a traditional antisemitic accusation or image from “Jews” to “Israel”, “Zionists” or Israelis, keeping the underlying stereotype.",
  },
  semantic_displacement: {
    number: 9,
    label: "Semantic displacement of Jews",
    definition:
      "Redefines a concept tied to the persecution of Jews so that Jews stop being its referent, or puts another group in their historical place.",
  },
  incitement_to_violence: {
    number: null,
    label: "Incitement to violence",
    definition: "Calls for, threatens, glorifies or justifies violence against Jews.",
  },
};

/** Display order: the framework's numbering, then calls for violence. */
export const IHRA_PATTERN_ORDER: IhraPattern[] = [
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
];

/** Mechanisms of a Nazi / Holocaust analogy. `code` is the framework's own name for each. */
export const ANALOGY_MECHANISMS: Record<AnalogyMechanism, { code: string; label: string; definition: string }> = {
  holocaust_analogy: {
    code: "HOLOCAUST_ANALOGY",
    label: "Holocaust analogy",
    definition: "Likens a contemporary event to the Holocaust or one of its sites, such as Auschwitz or the ghettos.",
  },
  nazi_comparison: {
    code: "NAZI_COMPARISON",
    label: "Nazi comparison",
    definition: "Equates Israeli policy or Israelis with Nazis, Hitler or the SS.",
  },
  symbolic_substitution: {
    code: "SYMBOLIC_SUBSTITUTION",
    label: "Symbolic substitution",
    definition: "Swaps the historical roles: Jews or Israelis cast as the perpetrators, another group as the Holocaust's victims.",
  },
  historical_resemanticization: {
    code: "HISTORICAL_RESEMANTICIZATION",
    label: "Historical resemanticization",
    definition: "Gives a historical term, such as Holocaust, ghetto or Final Solution, a new meaning detached from the persecution of Jews.",
  },
  false_equivalence: {
    code: "FALSE_EQUIVALENCE",
    label: "False equivalence",
    definition: "Treats two events as the same while ignoring differences in scale, aims, methods or context that are needed to understand them.",
  },
  holocaust_distortion: {
    code: "HOLOCAUST_DISTORTION",
    label: "Holocaust distortion",
    definition: "Misrepresents the Holocaust's facts, scale, mechanisms or intent, even without denying it.",
  },
};

export const ANALOGY_MECHANISM_ORDER: AnalogyMechanism[] = [
  "holocaust_analogy",
  "nazi_comparison",
  "symbolic_substitution",
  "historical_resemanticization",
  "false_equivalence",
  "holocaust_distortion",
];

export const COMPARISON_DIMENSIONS: Record<ComparisonDimension, string> = {
  casualty_magnitude: "Casualty magnitude",
  proportion_affected: "Proportion of the population affected",
  documented_objectives: "Documented objectives",
  targeting_criteria: "Targeting criteria",
  institutional_structures: "Institutional structures",
  methods_of_violence: "Methods of killing or violence",
  detention_and_deportation: "Detention and deportation",
  chronology_and_duration: "Chronology and duration",
  territorial_scope: "Territorial scope",
  legal_and_military_context: "Legal and military context",
  historical_context: "Historical context",
};

/** Fact versus interpretation, shown on every statement of a comparison. */
export const STATEMENT_BASIS: Record<StatementBasis, { label: string; tone: Tone; definition: string }> = {
  sourced: { label: "Sourced fact", tone: "positive", definition: "Stated by one of the listed sources." },
  established: {
    label: "Established fact",
    tone: "neutral",
    definition: "Well-established history or public record; no source was retrieved for it.",
  },
  interpretation: { label: "Interpretation", tone: "caution", definition: "The analysis's reading, not a fact." },
  unknown: { label: "Not established", tone: "caution", definition: "Disputed, or not settled by the available sources." },
};

export const IHRA_REVIEW_EXPLAINER =
  "Posts that touch on Jews, Israel, Zionism, the Holocaust or antisemitic tropes get a full review against the IHRA working definition and its examples: each pattern found is tested against the post's context, analogies are compared point by point, and facts are kept apart from interpretation.";

export const COMMUNITY_NOTE_2_EXPLAINER =
  "An extended, neutral explanation of what is misleading, what changes in meaning and why it matters, with sources. It is longer than an X Community Note: shorten it before posting.";

// ---------------------------------------------------------------------------
// AI confidence
// ---------------------------------------------------------------------------

export const CONFIDENCE_LEVELS: Record<Confidence, { label: string; definition: string }> = {
  high: { label: "High", definition: "The content is clear and the evidence is consistent." },
  medium: { label: "Medium", definition: "There is a reasonable basis, with some uncertainty left." },
  low: { label: "Low", definition: "The content is ambiguous or the evidence is thin. Treat the result with caution." },
};

export const CONFIDENCE_EXPLAINER =
  "How sure the AI is about its assessment. It is separate from the score: a post can get a low score with high confidence.";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EVIDENCE_VERDICTS: Record<EvidenceVerdict, Explained> = {
  contradicted: {
    label: "Contradicted",
    tone: "critical",
    definition: "The sources clearly contradict the claim.",
  },
  partially_supported: {
    label: "Partially supported",
    tone: "caution",
    definition: "Parts are accurate, but the claim as stated is incomplete, exaggerated or misleadingly framed.",
  },
  insufficient_evidence: {
    label: "Insufficient evidence",
    tone: "neutral",
    definition: "The sources found don't settle the claim either way.",
  },
  not_a_factual_claim: {
    label: "Not a factual claim",
    tone: "neutral",
    definition: "On inspection it is an opinion, prediction or argument, not a checkable fact.",
  },
  supported: {
    label: "Supported",
    tone: "positive",
    definition: "The sources clearly support the claim.",
  },
};

/** Display order for verdict summaries: most serious first. */
export const VERDICT_ORDER: EvidenceVerdict[] = [
  "contradicted",
  "partially_supported",
  "insufficient_evidence",
  "not_a_factual_claim",
  "supported",
];

export const SOURCES_EXPLAINER =
  "Sources come only from the web search results, and each link is checked. Kavannah never invents a source.";

export const UNVERIFIED_LINK_EXPLAINER = "Kavannah couldn't confirm that this link opens. Check it before relying on it.";

// ---------------------------------------------------------------------------
// The two questions
// ---------------------------------------------------------------------------

export const QUESTIONS = {
  engage: {
    title: "Should I engage?",
    explainer: "Whether posting a public reply to this post would help.",
  },
  communityNote: {
    title: "Should I add a Community Note?",
    explainer: "Whether a sourced Community Note would help readers, following X's own guidance.",
  },
} as const;

export const QUESTIONS_INDEPENDENT =
  "The two questions are answered separately, so one can say no while the other says yes.";
