import {
  COMMUNITY_NOTE_COPY,
  scoreBand,
  type Classification,
  type CommunityNoteRecommendation,
  type EngagementRecommendation,
  type EvidenceItem,
  type Source,
} from "@kavannah/shared";
import type { Tone } from "./labels";

/** The three decisions shown as collapsed sections; each header carries its verdict. */

export type DecisionId = "disinfo" | "engage" | "note";

export interface DecisionVerdict {
  label: string;
  tone: Tone;
}

export const ALL_CLOSED: Record<DecisionId, boolean> = { disinfo: false, engage: false, note: false };

/**
 * One-glance answer to "is it disinformation?", derived from the classification the backend
 * already returns: the score sets the severity, the labels and evidence refine the wording.
 */
export function disinfoVerdict(classification: Classification, evidence: EvidenceItem[]): DecisionVerdict {
  const score = Math.max(0, Math.min(100, Math.round(classification.disinformationScore)));
  const labels = new Set(classification.labels);
  const band = scoreBand(score);

  if (score >= 75) return { label: band.label, tone: "critical" };
  if (score >= 25) {
    if (labels.has("misleading_framing") && !labels.has("misinformation")) return { label: "Missing context", tone: "caution" };
    return { label: band.label, tone: "caution" };
  }

  const opinion = labels.has("opinion") || labels.has("political_or_historical_argument");
  if (opinion && !labels.has("factual_claim")) return { label: "Opinion", tone: "neutral" };

  const factual = evidence.filter((item) => item.verdict !== "not_a_factual_claim");
  if (factual.length > 0 && factual.every((item) => item.verdict === "supported")) return { label: "Accurate", tone: "positive" };
  return { label: band.label, tone: "neutral" };
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
