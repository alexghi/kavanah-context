import { useEffect, useState } from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import type { AnalysisMode, AnalysisPhase } from "@kavannah/shared";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";
import { Skeleton } from "./ui/skeleton";

export const ANALYSIS_STAGES = ["Extract claims", "Classify", "Retrieve evidence", "Assess evidence", "Recommend"] as const;
export const IHRA_STAGE = "IHRA review";
/** Before the first progress event, the timer advances one step every ~6 s and holds on the last one. */
export const STAGE_INTERVAL_MS = 6000;

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

export function StageProgress({
  startedAt,
  mode,
  phase,
  ihraPending = false,
  compact = false,
}: {
  startedAt: number;
  mode?: AnalysisMode | null;
  /** From the server's progress events; without it the steps advance on a timer. */
  phase?: AnalysisPhase;
  ihraPending?: boolean;
  /** Steps only, no result skeletons (the partial result is shown below instead). */
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsedMs = Math.max(0, now - startedAt);
  const { steps, current } = phase ? stepsForPhase(phase, ihraPending) : { steps: [...ANALYSIS_STAGES], current: stageIndexFor(elapsedMs) };
  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <div className={cn(compact ? "rounded-lg border border-border bg-card px-4 py-3" : "px-4 py-4")}>
      <div role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-center justify-between">
          <SectionLabel>Analyzing</SectionLabel>
          <span className="tabular-nums text-[12px] text-muted-foreground" aria-label={`${seconds} seconds elapsed`}>
            {seconds} s
          </span>
        </div>
        <ol className={cn("mt-3", compact ? "flex flex-wrap gap-x-4 gap-y-1.5" : "space-y-2")}>
          {steps.map((label, index) => {
            const status = index < current ? "done" : index === current ? "active" : "pending";
            return (
              <li
                key={label}
                aria-current={status === "active" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 text-[12.5px]",
                  status === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
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
        {!compact && (
          <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
            {mode === "mock"
              ? "Demo mode answers from built-in examples in about a second."
              : "The assessment appears in about 10 seconds; evidence and recommendations follow, usually within a minute."}
          </p>
        )}
      </div>
      {!compact && (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-3 h-4 w-3/5" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-4/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
