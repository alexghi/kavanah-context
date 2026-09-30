import { useState } from "react";
import { ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";
import type { EvidenceItem, Source } from "@kavannah/shared";
import { hostOf, VERDICT_TONE, verdictText, type Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const TONE_BADGE: Record<Tone, "positive" | "caution" | "critical" | "neutral"> = {
  positive: "positive",
  caution: "caution",
  critical: "critical",
  neutral: "neutral",
};

export function SourceItem({ source, compact = false }: { source: Source; compact?: boolean }) {
  return (
    <li className={cn("leading-5", compact ? "text-[12px]" : "text-[12.5px]")}>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-semibold text-foreground">{source.publisher ?? hostOf(source.url)}</span>{" "}
          <span className="text-foreground/90">{source.title}</span>
          <ExternalLink className="ml-1 inline size-3 align-[-1px] text-muted-foreground" aria-hidden="true" />
          <span className="sr-only-text">(opens in a new tab)</span>
        </a>
        {source.verified === false && (
          <Badge variant="caution" title="Kavannah could not confirm that this link resolves">
            <TriangleAlert aria-hidden="true" />
            Unverified link
          </Badge>
        )}
      </div>
      {source.whyItMatters && !compact && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">Why it matters:</span> {source.whyItMatters}
        </p>
      )}
    </li>
  );
}

function EvidenceClaim({ item }: { item: EvidenceItem }) {
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <Badge variant={TONE_BADGE[VERDICT_TONE[item.verdict]]}>{verdictText(item.verdict)}</Badge>
      <p className="mt-1.5 text-[13px] font-medium leading-5 text-foreground">{item.claim}</p>
      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{item.summary}</p>
      {item.sources.length === 0 ? (
        <p className="mt-2 text-[12px] italic text-muted-foreground">No sources could be retrieved for this claim.</p>
      ) : (
        <ul className="mt-2 space-y-2 border-t border-border pt-2">
          {item.sources.map((source) => (
            <SourceItem key={source.id} source={source} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) {
    return <p className="text-[12px] text-muted-foreground">No check-worthy factual claims were identified, so no evidence was retrieved.</p>;
  }
  const count = evidence.length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "Hide evidence" : "View evidence →"}
          <span className="font-normal text-muted-foreground">
            ({count} {count === 1 ? "claim" : "claims"})
          </span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-3 space-y-3">
          {evidence.map((item) => (
            <EvidenceClaim key={item.claimId} item={item} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
