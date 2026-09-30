import {
  ANTISEMITISM_CATEGORIES,
  CONTENT_LABELS,
  EVIDENCE_VERDICTS,
  VERDICT_ORDER,
  type AntisemitismCategory,
  type ContentLabel,
  type EvidenceItem,
  type EvidenceVerdict,
} from "@kavannah/shared";

/** Human wording for enum values coming from the shared contract (definitions: @kavannah/shared explain.ts). */

/** `snake_case_value` -> "Snake case value" (fallback for values the maps don't know). */
export function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function contentLabelText(label: ContentLabel): string {
  return CONTENT_LABELS[label]?.label ?? humanize(label);
}

export function verdictText(verdict: EvidenceVerdict): string {
  return EVIDENCE_VERDICTS[verdict]?.label ?? humanize(verdict);
}

export function antisemitismCategoryText(category: AntisemitismCategory): string {
  return ANTISEMITISM_CATEGORIES[category]?.label ?? humanize(category);
}

/** Verdict counts, most serious first: [{ verdict: "contradicted", count: 2 }, …]. */
export function verdictCounts(evidence: readonly EvidenceItem[]): Array<{ verdict: EvidenceVerdict; count: number }> {
  const counts = new Map<EvidenceVerdict, number>();
  for (const item of evidence) counts.set(item.verdict, (counts.get(item.verdict) ?? 0) + 1);
  return VERDICT_ORDER.filter((verdict) => counts.has(verdict)).map((verdict) => ({ verdict, count: counts.get(verdict)! }));
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
