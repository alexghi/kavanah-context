import type { AntisemitismCategory, Confidence, ContentLabel, EvidenceVerdict } from "@kavannah/shared";

/** Human wording for enum values coming from the shared contract. */

export const CONTENT_LABEL_TEXT: Record<ContentLabel, string> = {
  factual_claim: "Factual claim",
  opinion: "Opinion",
  political_or_historical_argument: "Political or historical argument",
  potentially_antisemitic: "Potentially antisemitic",
  misinformation: "Misinformation",
  misleading_framing: "Misleading framing",
  unverifiable_claim: "Unverifiable claim",
  benign: "Benign",
};

export const VERDICT_TEXT: Record<EvidenceVerdict, string> = {
  supported: "Supported",
  contradicted: "Contradicted",
  partially_supported: "Partially supported",
  insufficient_evidence: "Insufficient evidence",
  not_a_factual_claim: "Not a factual claim",
};

export const ANTISEMITISM_CATEGORY_TEXT: Record<AntisemitismCategory, string> = {
  conspiracy_or_control: "conspiracy or control tropes",
  dehumanising_or_threatening: "dehumanising or threatening language",
  holocaust_denial_or_distortion: "Holocaust denial or distortion",
  israel_related: "Israel-related",
  classic_tropes: "classic tropes",
  incitement_to_violence: "incitement to violence",
};

export const CONFIDENCE_TEXT: Record<Confidence, string> = { low: "low", medium: "medium", high: "high" };

export type Tone = "positive" | "caution" | "critical" | "neutral";

export const VERDICT_TONE: Record<EvidenceVerdict, Tone> = {
  supported: "positive",
  contradicted: "critical",
  partially_supported: "caution",
  insufficient_evidence: "neutral",
  not_a_factual_claim: "neutral",
};

/** `snake_case_value` -> "Snake case value" (fallback for values the maps don't know). */
export function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function contentLabelText(label: ContentLabel): string {
  return CONTENT_LABEL_TEXT[label] ?? humanize(label);
}

export function verdictText(verdict: EvidenceVerdict): string {
  return VERDICT_TEXT[verdict] ?? humanize(verdict);
}

export function antisemitismCategoryText(category: AntisemitismCategory): string {
  return ANTISEMITISM_CATEGORY_TEXT[category] ?? humanize(category).toLowerCase();
}

/** "a", "a and b", "a, b and c" */
export function joinWords(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Host of a URL without "www.", for compact source lines. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
