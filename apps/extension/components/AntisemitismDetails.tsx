import { ExternalLink } from "lucide-react";
import {
  ANTISEMITISM_CATEGORIES,
  ANTISEMITISM_EXCLUSIONS,
  ANTISEMITISM_LEVELS,
  IHRA_DEFINITION_URL,
  IHRA_PATTERNS,
  type AntisemitismAssessment,
} from "@kavannah/shared";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { GroupTitle } from "./SubSection";

export function IhraLink({ className }: { className?: string }) {
  return (
    <a
      href={IHRA_DEFINITION_URL}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm font-medium text-link underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      IHRA working definition
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only-text">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Body of the "Antisemitism" sub-section: what the level means, each category with its
 * definition, the model's reasoning for this post, and what the check is based on.
 * Likely / possible findings sit in a tinted box so they stand out from the rest of the card.
 */
export function AntisemitismDetails({ antisemitism }: { antisemitism: AntisemitismAssessment }) {
  const level = ANTISEMITISM_LEVELS[antisemitism.assessment];
  const flagged = antisemitism.assessment !== "not_detected";
  const tone = TONE_CLASSES[level.tone];
  // Current servers send IHRA patterns; older results only have the first-release categories.
  const items: Array<{ key: string; label: string; definition: string }> = antisemitism.patterns?.length
    ? [...new Set(antisemitism.patterns)].map((pattern) => {
        const info = IHRA_PATTERNS[pattern];
        return { key: pattern, label: info.number ? `${info.number}. ${info.label}` : info.label, definition: info.definition };
      })
    : [...new Set(antisemitism.categories)].map((category) => ({ key: category, ...ANTISEMITISM_CATEGORIES[category] }));

  return (
    <div className={cn("space-y-3", flagged && cn("rounded-md border p-3", tone.soft, tone.line))}>
      <p className="text-[12.5px] leading-5 text-foreground">{level.definition}</p>

      {items.length > 0 && (
        <div>
          <GroupTitle>{items.length === 1 ? "IHRA pattern" : "IHRA patterns"}</GroupTitle>
          <dl className="mt-1 space-y-2">
            {items.map((item) => (
              <div key={item.key}>
                <dt className={cn("text-[12.5px] font-semibold leading-5", flagged ? tone.text : "text-foreground")}>{item.label}</dt>
                <dd className="text-[12.5px] leading-5 text-muted-foreground">{item.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {antisemitism.explanation && (
        <div>
          <GroupTitle>In this post</GroupTitle>
          <p className="mt-0.5 text-[13px] leading-5 text-foreground">{antisemitism.explanation}</p>
        </div>
      )}

      <p className="text-[12px] leading-5 text-muted-foreground">
        Judged against the <IhraLink />. {ANTISEMITISM_EXCLUSIONS}
      </p>
    </div>
  );
}
