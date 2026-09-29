import type { CommunityNoteRecommendation, EngagementRecommendation } from "./schemas";

/**
 * Product copy for the two independent recommendations (from the product brief).
 * Shared so the backend's fixtures and the extension UI say exactly the same thing.
 */
export const ENGAGEMENT_COPY: Record<EngagementRecommendation, { title: string; short: string; description: string }> = {
  engage: {
    title: "Engage",
    short: "Engage",
    description: "A factual response could add useful context.",
  },
  do_not_engage: {
    title: "Don't engage",
    short: "Don't engage",
    description: "A public response may not add useful context or may unnecessarily amplify the content.",
  },
  uncertain: {
    title: "Uncertain",
    short: "Uncertain",
    description: "There is not enough information to make a reliable recommendation.",
  },
};

export const COMMUNITY_NOTE_COPY: Record<CommunityNoteRecommendation, { title: string; short: string; description: string }> = {
  recommended: {
    title: "Community Note recommended",
    short: "Recommended",
    description: "The post contains a factual claim where additional context could help readers.",
  },
  not_recommended: {
    title: "Community Note not recommended",
    short: "Not recommended",
    description: "There is no clear factual claim that would benefit from a note.",
  },
  uncertain: {
    title: "Uncertain",
    short: "Uncertain",
    description: "There is insufficient evidence.",
  },
};

export type ScoreBand = { min: number; label: string; tone: "neutral" | "caution" | "warning" | "critical" };

/** Bands for the indicative disinformation score. Always presented as an AI assessment. */
export const SCORE_BANDS: ScoreBand[] = [
  { min: 75, label: "Likely misleading", tone: "critical" },
  { min: 50, label: "Potentially misleading", tone: "warning" },
  { min: 25, label: "Some concerns", tone: "caution" },
  { min: 0, label: "No clear factual issue", tone: "neutral" },
];

export function scoreBand(score: number): ScoreBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return SCORE_BANDS.find((b) => s >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]!;
}

export const SCORE_DISCLAIMER =
  "Indicative AI assessment of how misleading the post's factual content appears. Not a measure of how much of the post is false.";
