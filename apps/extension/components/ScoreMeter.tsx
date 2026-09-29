import { useId } from "react";
import { Sparkles } from "lucide-react";
import { SCORE_DISCLAIMER, scoreBand, type Confidence, type ScoreBand } from "@kavannah/shared";
import { CONFIDENCE_TEXT } from "@/lib/labels";
import { cn } from "@/lib/utils";

const BAR_CLASS: Record<ScoreBand["tone"], string> = {
  neutral: "bg-neutral/70",
  caution: "bg-caution/70",
  warning: "bg-caution",
  critical: "bg-critical",
};

const TEXT_CLASS: Record<ScoreBand["tone"], string> = {
  neutral: "text-neutral",
  caution: "text-caution",
  warning: "text-caution",
  critical: "text-critical",
};

export function ScoreMeter({ score, confidence }: { score: number; confidence: Confidence }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(clamped);
  const disclaimerId = useId();

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-[13px] font-semibold", TEXT_CLASS[band.tone])}>{band.label}</span>
          <span className="tabular-nums text-[12px] text-muted-foreground">{clamped} / 100</span>
        </div>
        <span
          tabIndex={0}
          title={SCORE_DISCLAIMER}
          aria-describedby={disclaimerId}
          className="inline-flex cursor-help items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="size-3" aria-hidden="true" />
          AI assessment
        </span>
      </div>
      <div
        role="meter"
        aria-label="Disinformation score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} out of 100, ${band.label}`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", BAR_CLASS[band.tone])} style={{ width: `${clamped}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-muted-foreground">Indicative, not a % of false content</p>
        <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          Confidence: {CONFIDENCE_TEXT[confidence]}
        </span>
      </div>
      <span id={disclaimerId} className="sr-only-text">
        {SCORE_DISCLAIMER}
      </span>
    </div>
  );
}
