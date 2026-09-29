import { useEffect, useState } from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import type { AnalysisMode } from "@kavannah/shared";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";
import { Skeleton } from "./ui/skeleton";

export const ANALYSIS_STAGES = ["Extract claims", "Classify", "Retrieve evidence", "Assess evidence", "Recommend"] as const;
/** The timer advances one step every ~6 s and holds on the last one until the response arrives. */
export const STAGE_INTERVAL_MS = 6000;

export function stageIndexFor(elapsedMs: number): number {
  return Math.min(ANALYSIS_STAGES.length - 1, Math.max(0, Math.floor(elapsedMs / STAGE_INTERVAL_MS)));
}

export function StageProgress({ startedAt, mode }: { startedAt: number; mode?: AnalysisMode | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsedMs = Math.max(0, now - startedAt);
  const current = stageIndexFor(elapsedMs);
  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <div className="px-4 py-4">
      <div role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-center justify-between">
          <SectionLabel>Analyzing</SectionLabel>
          <span className="tabular-nums text-[12px] text-muted-foreground" aria-label={`${seconds} seconds elapsed`}>
            {seconds} s
          </span>
        </div>
        <ol className="mt-3 space-y-2">
          {ANALYSIS_STAGES.map((label, index) => {
            const status = index < current ? "done" : index === current ? "active" : "pending";
            return (
              <li
                key={label}
                aria-current={status === "active" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 text-[13px]",
                  status === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {status === "done" && (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-positive-soft text-positive">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                )}
                {status === "active" && (
                  <span className="inline-flex size-5 items-center justify-center text-primary">
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
        <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
          {mode === "mock"
            ? "Demo mode answers from built-in examples in about a second."
            : "Live analysis takes about 30-60 seconds."}
        </p>
      </div>
      <div className="mt-4 space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-3 h-4 w-3/5" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
