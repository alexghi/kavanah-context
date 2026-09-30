import type { ReactNode } from "react";
import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, TriangleAlert } from "lucide-react";
import type { DecisionVerdict } from "@/lib/decisions";
import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const TONE_STATUS: Record<Tone, { Icon: typeof CircleCheck; iconClass: string; bgClass: string }> = {
  positive: { Icon: CircleCheck, iconClass: "text-positive", bgClass: "bg-positive-soft" },
  neutral: { Icon: CircleMinus, iconClass: "text-neutral", bgClass: "bg-neutral-soft" },
  caution: { Icon: CircleAlert, iconClass: "text-caution", bgClass: "bg-caution-soft" },
  critical: { Icon: TriangleAlert, iconClass: "text-critical", bgClass: "bg-critical-soft" },
};

export interface DecisionSectionProps {
  /** Short section name shown before the verdict: "Disinfo", "Engage", "Note". */
  label: string;
  verdict: DecisionVerdict;
  /** Small extras next to the verdict (confidence, flags); stay visible while collapsed. */
  meta?: ReactNode;
  /** Plain-text version of `meta` for the header's accessible name. */
  metaText?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

/** One decision: the header alone answers the question, the body holds the details. */
export function DecisionSection({ label, verdict, meta, metaText, open, onOpenChange, children }: DecisionSectionProps) {
  const status = TONE_STATUS[verdict.tone];
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
              <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", status.bgClass)}>
                <status.Icon className={cn("size-4", status.iconClass)} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="section-label block">{label}</span>
                <span className="block text-[15px] font-semibold leading-tight tracking-tight">{verdict.label}</span>
              </span>
              {meta && <span className="flex shrink-0 flex-col items-end gap-1">{meta}</span>}
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border p-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
