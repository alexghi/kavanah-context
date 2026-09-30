import {
  COMMUNITY_NOTE_COPY,
  scoreBand,
  type Classification,
  type CommunityNoteRecommendation,
  type EngagementRecommendation,
  type EvidenceItem,
  type Source,
  type Tone,
} from "@kavannah/shared";

/** The three decisions shown as collapsed sections; each header carries its verdict. */

export type DecisionId = "disinfo" | "engage" | "note";

export interface DecisionVerdict {
  label: string;
  tone: Tone;
}

/** The content section's verdict: always one of the factual verdicts. */
export interface FactualVerdict extends DecisionVerdict {
  label: keyof typeof FACTUAL_VERDICTS;
}

export const ALL_CLOSED: Record<DecisionId, boolean> = { disinfo: false, engage: false, note: false };

/** The factual verdicts, each with its meaning. Kept apart from the manipulation signals. */
export const FACTUAL_VERDICTS = {
  Accurate: "The checkable claims are supported by the sources.",
  Misleading: "Part of the factual content is wrong or leads readers to a false conclusion.",
  "Missing context": "The facts may be right, but what the post leaves out or how it frames them changes their meaning.",
  False: "A central factual claim is contradicted by well-established evidence.",
  Unverifiable: "The central claim can't be checked with public sources.",
  Opinion: "Mainly a value judgement or an argument, which can't be fact-checked.",
  "No clear factual issue": "No false or misleading factual content was found, and nothing could be confirmed as accurate either.",
} as const;

export const VERDICT_EXPLAINER =
  "The verdict says whether the post's facts hold up. The manipulation signals say how the post may mislead. They are judged separately.";

/** Header of the content section; the verdict follows it ("…: Missing context"). */
export const ASSESSMENT_LABEL = "Content & manipulation assessment";

/**
 * The factual verdict (Accurate, Misleading, Missing context, False, Unverifiable, Opinion),
 * derived from the classification the backend already returns: the score sets the severity, the
 * labels and evidence pick the word. How the post misleads is said by the manipulation signals.
 */
export function disinfoVerdict(classification: Classification, evidence: EvidenceItem[]): FactualVerdict {
  const score = Math.max(0, Math.min(100, Math.round(classification.disinformationScore)));
  const labels = new Set(classification.labels);
  const band = scoreBand(score);

  if (score >= 25) {
    if (labels.has("misinformation")) return score >= 75 ? { label: "False", tone: "critical" } : { label: "Misleading", tone: band.tone };
    if (labels.has("misleading_framing")) return { label: "Missing context", tone: band.tone };
    if (labels.has("unverifiable_claim")) return { label: "Unverifiable", tone: band.tone };
    return { label: "Misleading", tone: band.tone };
  }

  if (labels.has("unverifiable_claim")) return { label: "Unverifiable", tone: "neutral" };
  const opinion = labels.has("opinion") || labels.has("political_or_historical_argument");
  if (opinion && !labels.has("factual_claim")) return { label: "Opinion", tone: "neutral" };

  const factual = evidence.filter((item) => item.verdict !== "not_a_factual_claim");
  if (factual.length > 0 && factual.every((item) => item.verdict === "supported")) return { label: "Accurate", tone: "positive" };
  return { label: "No clear factual issue", tone: "neutral" };
}

const ENGAGE_VERDICT: Record<EngagementRecommendation, DecisionVerdict> = {
  engage: { label: "Yes", tone: "positive" },
  do_not_engage: { label: "No", tone: "neutral" },
  uncertain: { label: "Uncertain", tone: "caution" },
};

export function engageVerdict(recommendation: EngagementRecommendation): DecisionVerdict {
  return ENGAGE_VERDICT[recommendation];
}

const NOTE_TONE: Record<CommunityNoteRecommendation, Tone> = {
  recommended: "positive",
  not_recommended: "neutral",
  uncertain: "caution",
};

export function noteVerdict(recommendation: CommunityNoteRecommendation): DecisionVerdict {
  return { label: COMMUNITY_NOTE_COPY[recommendation].short, tone: NOTE_TONE[recommendation] };
}

/** The few sources worth showing up front: deduped by URL, verified first, evidence order otherwise. */
export function keySources(evidence: EvidenceItem[], max = 3): Source[] {
  const byUrl = new Map<string, Source>();
  for (const item of evidence) {
    for (const source of item.sources) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }
  return [...byUrl.values()].sort((a, b) => Number(b.verified) - Number(a.verified)).slice(0, max);
}
