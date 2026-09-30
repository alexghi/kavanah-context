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

export type ScoreBand = {
  min: number;
  max: number;
  label: string;
  tone: "neutral" | "caution" | "warning" | "critical";
  /** What a score in this band means, in one sentence. */
  meaning: string;
};

/** Bands for the indicative manipulation score (shown as "Manipulation signals") (highest first). Always presented as an AI estimate. */
export const SCORE_BANDS: ScoreBand[] = [
  { min: 75, max: 100, label: "Likely misleading", tone: "critical", meaning: "The factual content is false or seriously misleading." },
  { min: 50, max: 74, label: "Potentially misleading", tone: "warning", meaning: "Significant parts of the factual content could mislead readers." },
  { min: 25, max: 49, label: "Some concerns", tone: "caution", meaning: "Minor inaccuracies, exaggeration or missing context." },
  { min: 0, max: 24, label: "No clear factual issue", tone: "neutral", meaning: "No false or misleading factual content was found." },
];

export function scoreBand(score: number): ScoreBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return SCORE_BANDS.find((b) => s >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]!;
}

export const SCORE_DISCLAIMER =
  "An AI estimate of how misleading the post's factual content is, from 0 (no issue found) to 100 (clearly false). It rates facts only, so hateful content with no factual claim can score low. It is not the share of the post that is false.";
