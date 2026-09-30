import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { DecisionVerdict } from "@/lib/decisions";
import { cn } from "@/lib/utils";
import { StatusMark, type RecommendationStatus } from "./RecommendationStatus";
import { Card } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export interface DecisionSectionProps {
  /** Section name shown above the verdict: "Content & manipulation assessment", "Engage", "Note". */
  label: string;
  verdict: DecisionVerdict;
  status: RecommendationStatus;
  /** Small extras next to the verdict (flags); stay visible while collapsed. */
  meta?: ReactNode;
  /** Plain-text version of `meta` for the header's accessible name. */
  metaText?: string;
  /** Shown under the header whether the section is open or not (the score). */
  summary?: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

/** One decision: the header alone answers the question, the body holds the details. */
export function DecisionSection({ label, verdict, status, meta, metaText, summary, open, onOpenChange, children }: DecisionSectionProps) {
  const name = `${label}: ${verdict.label}`;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <h3>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={metaText ? `${name} (${metaText})` : name}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StatusMark status={status} />
              <span className="min-w-0 flex-1">
                <span className="section-label block">{label}</span>
                <span className="block text-[17px] font-semibold leading-tight tracking-tight">{verdict.label}</span>
              </span>
              {meta && <span className="flex shrink-0 flex-col items-end gap-1">{meta}</span>}
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
        </h3>
        {summary && <div className="px-4 pb-3.5">{summary}</div>}
        <CollapsibleContent>
          <div className="border-t border-border">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
