import { useId } from "react";
import { SCORE_BANDS, SCORE_DISCLAIMER, scoreBand } from "@kavannah/shared";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { ToneBadge } from "./ui/badge";

/** Bands from 0 upwards, for the scale and its legend. */
const BANDS_ASC = [...SCORE_BANDS].sort((a, b) => a.min - b.min);

/**
 * The disinformation score: the number, its band as a chip, a four-band scale with a marker at
 * the score, a legend with every band's range, and what the band means in words.
 */
export function ScoreMeter({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(clamped);
  const disclaimerId = useId();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="flex items-baseline gap-1 leading-none" aria-hidden="true">
          <span className="text-[26px] font-bold tabular-nums tracking-tight text-foreground">{clamped}</span>
          <span className="text-[13px] font-medium text-muted-foreground">/ 100</span>
        </p>
        <ToneBadge tone={band.tone}>{band.label}</ToneBadge>
      </div>

      <div>
        <div className="relative py-1">
          <div
            role="meter"
            aria-label="Disinformation score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clamped}
            aria-valuetext={`${clamped} out of 100: ${band.label}`}
            aria-describedby={disclaimerId}
            className="flex h-2.5 w-full gap-[3px]"
          >
            {BANDS_ASC.map((b) => (
              <span
                key={b.min}
                className={cn("h-full rounded-full", b === band ? TONE_CLASSES[b.tone].fill : TONE_CLASSES[b.tone].track)}
                style={{ flexGrow: b.max - b.min + 1, flexBasis: 0 }}
              />
            ))}
          </div>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card bg-foreground shadow-sm"
            style={{ left: `${clamped}%` }}
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1" aria-label="Score bands">
          {BANDS_ASC.map((b) => {
            const active = b === band;
            return (
              <li
                key={b.min}
                className={cn("flex items-center gap-1.5 whitespace-nowrap text-[11.5px] leading-4", active ? "font-semibold text-foreground" : "text-muted-foreground")}
              >
                <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[3px]", TONE_CLASSES[b.tone].fill)} />
                <span>
                  {b.label} <span className="tabular-nums">{b.min}–{b.max}</span>
                  {active && <span className="sr-only-text"> (this post)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-1">
        <p className="text-[12.5px] font-medium leading-5 text-foreground">{band.meaning}</p>
        <p id={disclaimerId} className="text-[12px] leading-5 text-muted-foreground">
          {SCORE_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
