import { useEffect, useRef, useState } from "react";
import { useArrival } from "@/hooks/useArrival";
import { Check, Circle, LoaderCircle } from "lucide-react";
import type { AnalysisMode, AnalysisPhase } from "@kavannah/shared";
import { cn, formatDuration } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";

export const ANALYSIS_STAGES = ["Extract claims", "Classify", "Retrieve evidence", "Assess evidence", "Recommend"] as const;
export const IHRA_STAGE = "IHRA review";
/** Before the first progress event, the timer advances one step every ~6 s and holds on the last one. */
export const STAGE_INTERVAL_MS = 6000;

/** One short line under the steps, always present so the strip never changes height. */
export function statusLine(phase: AnalysisPhase | undefined, done: boolean, mode: AnalysisMode | null | undefined, ihraPending: boolean): string {
  if (done) return "Every step is done. The cards below are final.";
  if (mode === "mock") return "Demo mode answers from built-in examples in about a second.";
  switch (phase) {
    case "checking_evidence":
      return "Assessment in. Checking the post's claims against sources…";
    case "reviewing_ihra":
      return "Evidence in. Running the full IHRA review…";
    case "recommending":
      return ihraPending ? "Deciding the two recommendations…" : "Evidence in. Deciding the two recommendations…";
    default:
      return "The assessment appears in a few seconds; evidence and recommendations follow.";
  }
}

export function stageIndexFor(elapsedMs: number): number {
  return Math.min(ANALYSIS_STAGES.length - 1, Math.max(0, Math.floor(elapsedMs / STAGE_INTERVAL_MS)));
}

/** The step list and the current step once the server reports where it is. */
export function stepsForPhase(phase: AnalysisPhase, ihraPending: boolean): { steps: string[]; current: number } {
  const steps: string[] = [...ANALYSIS_STAGES.slice(0, 4), ...(ihraPending || phase === "reviewing_ihra" ? [IHRA_STAGE] : []), ANALYSIS_STAGES[4]];
  const evidenceEnd = 4; // index after "Assess evidence"
  switch (phase) {
    case "classifying":
      return { steps, current: 1 };
    case "checking_evidence":
      return { steps, current: 2 };
    case "reviewing_ihra":
      return { steps, current: steps.indexOf(IHRA_STAGE) >= 0 ? steps.indexOf(IHRA_STAGE) : evidenceEnd };
    case "recommending":
      return { steps, current: steps.length - 1 };
    case "done":
      return { steps, current: steps.length };
  }
}

export interface StageProgressProps {
  startedAt: number;
  /** Set when the analysis is complete: freezes the clock and checks every step. */
  finishedAt?: number;
  mode?: AnalysisMode | null;
  /** From the server's progress events; without it the steps advance on a timer. */
  phase?: AnalysisPhase;
  ihraPending?: boolean;
}

/** The step list. Compact and always the same height, so the cards below it never move while it is shown. */
export function StageProgress({ startedAt, finishedAt, mode, phase, ihraPending = false }: StageProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finishedAt !== undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finishedAt]);
  const done = finishedAt !== undefined;
  const elapsedMs = Math.max(0, (finishedAt ?? now) - startedAt);
  const { steps, current } = done ? stepsForPhase("done", ihraPending) : phase ? stepsForPhase(phase, ihraPending) : { steps: [...ANALYSIS_STAGES], current: stageIndexFor(elapsedMs) };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-center justify-between">
          <SectionLabel className={cn(done && "text-positive-strong")}>{done ? "Analysis complete" : "Analyzing"}</SectionLabel>
          <span className="tabular-nums text-[12px] text-muted-foreground" aria-label={`${formatDuration(elapsedMs)} elapsed`}>
            {done ? formatDuration(elapsedMs) : `${Math.floor(elapsedMs / 1000)} s`}
          </span>
        </div>
        <ol className="mt-2.5 flex min-h-[2.9rem] flex-wrap content-start gap-x-4 gap-y-1.5">
          {steps.map((label, index) => {
            const status = index < current ? "done" : index === current ? "active" : "pending";
            return (
              <li
                key={label}
                aria-current={status === "active" ? "step" : undefined}
                className={cn("flex items-center gap-2 text-[12.5px]", status === "pending" ? "text-muted-foreground" : "text-foreground")}
              >
                {status === "done" && (
                  <span className="inline-flex size-5 items-center justify-center rounded-full border border-positive-line bg-positive-soft text-positive-strong">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                )}
                {status === "active" && (
                  <span className="inline-flex size-5 items-center justify-center text-link">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  </span>
                )}
                {status === "pending" && (
                  <span className="inline-flex size-5 items-center justify-center text-muted-foreground/60">
                    <Circle className="size-3" aria-hidden="true" />
                  </span>
                )}
                <span className={cn(status === "active" && "font-medium")}>{label}</span>
                <span className="sr-only-text">{status === "done" ? "done" : status === "active" ? "in progress" : "pending"}</span>
              </li>
            );
          })}
        </ol>
        <p className={cn("mt-2 truncate text-[12px] leading-5", done ? "text-positive-strong" : "text-muted-foreground")}>{statusLine(phase, done, mode, ihraPending)}</p>
      </div>
    </div>
  );
}

/**
 * The progress strip above the cards. It keeps its place and height for the whole analysis and
 * after it: when the result is in, the steps all show as done, the strip breathes once, and the
 * cards below it never move. A result that is already complete when the panel opens (reopened
 * or cached) shows no strip, so nothing appears just to sit there.
 */
export function ProgressStrip(props: StageProgressProps) {
  const done = props.finishedAt !== undefined;
  const mountedDone = useRef(done);
  const doneArrived = useArrival(done);
  useEffect(() => {
    if (!done) mountedDone.current = false;
  }, [done]);
  if (mountedDone.current) return null;
  return (
    <div className={cn("mb-3 rounded-lg", doneArrived && "kavannah-breathe")}>
      <StageProgress {...props} />
    </div>
  );
}
