import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { EVIDENCE_VERDICTS, SOURCES_EXPLAINER, UNVERIFIED_LINK_EXPLAINER, type EvidenceItem, type Source } from "@kavannah/shared";
import { hostOf, verdictCounts, verdictText } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { GroupTitle } from "./SubSection";
import { ToneBadge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export function SourceItem({ source, compact = false }: { source: Source; compact?: boolean }) {
  const unverified = source.verified === false;
  return (
    <li className={cn("leading-5", compact ? "text-[12px]" : "text-[12.5px]")}>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-semibold text-foreground">{source.publisher ?? hostOf(source.url)}</span>
        <span className="text-foreground">{source.title}</span>
        {unverified && (
          <ToneBadge tone="caution" title={UNVERIFIED_LINK_EXPLAINER}>
            Unverified link
          </ToneBadge>
        )}
      </div>
      {source.whyItMatters && !compact && (
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground">Why it matters:</span> {source.whyItMatters}
        </p>
      )}
      {unverified && !compact && <p className="text-[12px] text-muted-foreground">{UNVERIFIED_LINK_EXPLAINER}</p>}
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open source
        <ExternalLink className="size-3" aria-hidden="true" />
        <span className="sr-only-text">(opens in a new tab)</span>
      </a>
    </li>
  );
}

function EvidenceClaim({ item }: { item: EvidenceItem }) {
  const verdict = EVIDENCE_VERDICTS[item.verdict];
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ToneBadge tone={verdict?.tone ?? "neutral"}>{verdictText(item.verdict)}</ToneBadge>
        {verdict && <span className="text-[12px] leading-5 text-muted-foreground">{verdict.definition}</span>}
      </div>
      <p className="mt-2 border-l-2 border-input pl-2.5 text-[13px] font-medium leading-5 text-foreground">{item.claim}</p>
      <p className="mt-1.5 text-[12.5px] leading-5 text-foreground">{item.summary}</p>
      {item.sources.length === 0 ? (
        <p className="mt-2 text-[12px] italic text-muted-foreground">No sources could be retrieved for this claim.</p>
      ) : (
        <div className="mt-2.5 border-t border-border pt-2.5">
          <GroupTitle>{item.sources.length === 1 ? "Source" : "Sources"}</GroupTitle>
          <ul className="mt-1 space-y-2">
            {item.sources.map((source) => (
              <SourceItem key={source.id} source={source} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Verdict summary (always visible) and the per-claim evidence behind a disclosure. */
export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) {
    return (
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        No check-worthy factual claims were identified, so no evidence was retrieved.
      </p>
    );
  }
  const count = evidence.length;
  return (
    <div>
      <p className="text-[12.5px] leading-5 text-foreground">
        {count} {count === 1 ? "claim was" : "claims were"} checked against sources:
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Verdicts">
        {verdictCounts(evidence).map(({ verdict, count: n }) => (
          <li key={verdict}>
            <ToneBadge tone={EVIDENCE_VERDICTS[verdict]?.tone ?? "neutral"}>{`${verdictText(verdict)} (${n})`}</ToneBadge>
          </li>
        ))}
      </ul>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="mt-2.5 inline-flex cursor-pointer items-center gap-1 rounded-sm text-[12.5px] font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? "Hide evidence" : "View evidence"}
            <span className="font-normal text-muted-foreground">
              ({count} {count === 1 ? "claim" : "claims"})
            </span>
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 space-y-3" aria-label="Checked claims">
            {evidence.map((item) => (
              <EvidenceClaim key={item.claimId} item={item} />
            ))}
          </ul>
          <p className="mt-2.5 text-[12px] leading-5 text-muted-foreground">{SOURCES_EXPLAINER}</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
