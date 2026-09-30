import { CONFIDENCE_LEVELS, MANIPULATION_EXPLAINER, MANIPULATION_GROUPS, MANIPULATION_LEVELS, MANIPULATION_TECHNIQUES, type Manipulation } from "@kavannah/shared";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { GroupTitle } from "./SubSection";
import { ToneBadge } from "./ui/badge";

/**
 * Body of the "Manipulation" sub-section: what the level means, then each technique found with
 * the post's own words that carry it, what it does to the reader, and the AI's confidence.
 */
export function ManipulationDetails({ manipulation }: { manipulation: Manipulation }) {
  const level = MANIPULATION_LEVELS[manipulation.level];
  const tone = TONE_CLASSES[level.tone];
  const flagged = manipulation.level !== "none";
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-5 text-foreground">{level.definition}</p>
      {manipulation.summary && <p className="text-[13px] leading-5 text-foreground">{manipulation.summary}</p>}
      {manipulation.findings.length > 0 && (
        <div className={cn("rounded-md border p-3", tone.soft, tone.line)}>
          <GroupTitle hint="most important first">{manipulation.findings.length === 1 ? "Technique found" : "Techniques found"}</GroupTitle>
          <ol className="mt-1.5 space-y-3" aria-label="Manipulation techniques found">
            {manipulation.findings.map((finding, index) => {
              const info = MANIPULATION_TECHNIQUES[finding.technique];
              const confidence = CONFIDENCE_LEVELS[finding.confidence];
              return (
                <li key={`${finding.technique}-${index}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ToneBadge tone={level.tone}>{info.label}</ToneBadge>
                    <span className="text-[12px] text-muted-foreground">{MANIPULATION_GROUPS[info.group].title}</span>
                    <span className="text-[12px] text-muted-foreground">
                      · Confidence: <span className={cn("font-semibold", flagged ? tone.text : "text-foreground")}>{confidence.label}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{info.definition}</p>
                  {finding.trigger && (
                    <p className="mt-1.5 border-l-2 border-input pl-2.5 text-[12.5px] italic leading-5 text-foreground">“{finding.trigger}”</p>
                  )}
                  <p className="mt-1 text-[12.5px] leading-5 text-foreground">{finding.explanation}</p>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="text-[12px] leading-5 text-muted-foreground">{MANIPULATION_EXPLAINER}</p>
    </div>
  );
}
