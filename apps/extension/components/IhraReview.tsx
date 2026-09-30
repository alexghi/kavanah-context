import { useState } from "react";
import { ChevronDown, FileText, Link2, Scale } from "lucide-react";
import {
  ANALOGY_MECHANISMS,
  ANTISEMITISM_LEVELS,
  COMMUNITY_NOTE_2_EXPLAINER,
  COMPARISON_DIMENSIONS,
  CONFIDENCE_LEVELS,
  IHRA_PATTERNS,
  STATEMENT_BASIS,
  type IhraAssessment,
  type IhraFinding,
  type StatementBasis,
} from "@kavannah/shared";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { CopyButton } from "./DraftEditor";
import { SourceItem } from "./EvidenceList";
import { GroupTitle } from "./SubSection";
import { Badge, ToneBadge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

function Bullets({ items, marker, className }: { items: string[]; marker?: string; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("space-y-0.5 text-[12.5px] leading-5", className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-1.5">
          {marker && <span className="shrink-0 font-semibold">{marker}</span>}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BasisBadge({ basis }: { basis: StatementBasis }) {
  const info = STATEMENT_BASIS[basis];
  return (
    <Badge variant={info.tone} title={info.definition}>
      {info.label}
    </Badge>
  );
}

function SourceRefs({ ids, sources }: { ids: string[]; sources: IhraAssessment["sources"] }) {
  const known = ids.filter((id) => sources.some((s) => s.id === id));
  if (known.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {known.map((id) => {
        const source = sources.find((s) => s.id === id)!;
        return (
          <a
            key={id}
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            title={source.title}
            className="inline-flex items-center gap-0.5 rounded-sm text-[11.5px] font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Link2 className="size-3" aria-hidden="true" />
            {id}
          </a>
        );
      })}
    </span>
  );
}

function Finding({ finding, index }: { finding: IhraFinding; index: number }) {
  const info = IHRA_PATTERNS[finding.pattern];
  const confidence = CONFIDENCE_LEVELS[finding.confidence];
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ToneBadge tone="critical">{`${index + 1}. ${info.label}`}</ToneBadge>
        <span className="text-[12px] text-muted-foreground">
          Confidence: <span className="font-semibold text-foreground">{confidence.label}</span>
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{info.definition}</p>
      <dl className="mt-2 space-y-2 text-[12.5px] leading-5">
        <div>
          <dt className="font-semibold text-foreground">Evidence in the post</dt>
          <dd className="border-l-2 border-input pl-2.5 italic text-foreground">“{finding.trigger}”</dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">IHRA example</dt>
          <dd className="text-foreground">{finding.ihraExample}</dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Why it applies</dt>
          <dd className="text-foreground">{finding.whyItApplies}</dd>
        </div>
        {(finding.strengthens.length > 0 || finding.weakens.length > 0) && (
          <div>
            <dt className="font-semibold text-foreground">Context</dt>
            <dd className="space-y-1">
              <Bullets items={finding.strengthens} marker="+" className="text-foreground" />
              <Bullets items={finding.weakens} marker="−" className="text-muted-foreground" />
            </dd>
          </div>
        )}
        {(finding.facts.length > 0 || finding.interpretations.length > 0) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {finding.facts.length > 0 && (
              <div>
                <dt className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Badge variant="positive">Facts</Badge>
                </dt>
                <dd>
                  <Bullets items={finding.facts} marker="•" className="mt-1 text-foreground" />
                </dd>
              </div>
            )}
            {finding.interpretations.length > 0 && (
              <div>
                <dt className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Badge variant="caution">Interpretation</Badge>
                </dt>
                <dd>
                  <Bullets items={finding.interpretations} marker="•" className="mt-1 text-muted-foreground" />
                </dd>
              </div>
            )}
          </div>
        )}
      </dl>
    </li>
  );
}

function Chain({ steps }: { steps: Array<{ label: string; text: string }> }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-2 text-[12.5px] leading-5">
          <span className="w-4 shrink-0 text-right font-semibold text-muted-foreground" aria-hidden="true">
            {i === 0 ? "" : "→"}
          </span>
          <span>
            <span className="font-semibold text-foreground">{step.label}: </span>
            <span className="text-foreground">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The full IHRA ANTISEMITISM ASSESSMENT: findings with their context test, the semantic
 * mechanism and historical context, the point-by-point analogy comparison, trope and
 * displacement chains, the double-standard check, sources, and COMMUNITY NOTE 2.0.
 */
export function IhraReview({ ihra }: { ihra: IhraAssessment }) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const level = ANTISEMITISM_LEVELS[ihra.assessment];
  const tone = TONE_CLASSES[level.tone];
  const analogy = ihra.analogy;
  const note = ihra.communityNote2;

  return (
    <div className="space-y-4" aria-label="IHRA assessment">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Scale className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-foreground">IHRA assessment</span>
          <ToneBadge tone={level.tone}>{level.label}</ToneBadge>
          <span className="text-[12px] text-muted-foreground">
            Confidence: <span className="font-semibold text-foreground">{CONFIDENCE_LEVELS[ihra.confidence].label}</span>
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-5 text-foreground">{ihra.summary}</p>
      </div>

      {ihra.findings.length > 0 && (
        <div>
          <GroupTitle hint="each pattern found, with the context test">{ihra.findings.length === 1 ? "Relevant IHRA pattern" : "Relevant IHRA patterns"}</GroupTitle>
          <ol className="mt-1.5 space-y-2" aria-label="IHRA findings">
            {ihra.findings.map((finding, index) => (
              <Finding key={`${finding.pattern}-${index}`} finding={finding} index={index} />
            ))}
          </ol>
        </div>
      )}

      {(ihra.mechanism || ihra.historicalContext || ihra.omittedDifferences.length > 0) && (
        <dl className="space-y-2.5">
          {ihra.mechanism && (
            <div>
              <dt className="text-[12px] font-semibold text-foreground">Semantic or narrative mechanism</dt>
              <dd className="text-[12.5px] leading-5 text-foreground">{ihra.mechanism}</dd>
            </div>
          )}
          {ihra.historicalContext && (
            <div>
              <dt className="text-[12px] font-semibold text-foreground">Historical or factual context</dt>
              <dd className="text-[12.5px] leading-5 text-foreground">{ihra.historicalContext}</dd>
            </div>
          )}
          {ihra.omittedDifferences.length > 0 && (
            <div>
              <dt className="text-[12px] font-semibold text-foreground">Material differences the post omits</dt>
              <dd>
                <Bullets items={ihra.omittedDifferences} marker="•" className="mt-0.5 text-foreground" />
              </dd>
            </div>
          )}
        </dl>
      )}

      {analogy && (
        <div className={cn("rounded-md border p-3", tone.soft, tone.line)}>
          <GroupTitle>Nazi or Holocaust analogy</GroupTitle>
          <p className="mt-1 text-[12.5px] leading-5 text-foreground">
            <span className="font-semibold">{analogy.historicalReferent}</span> <span aria-hidden="true">↔</span>{" "}
            <span className="sr-only-text">compared with</span>
            <span className="font-semibold">{analogy.contemporaryReferent}</span>
          </p>
          {analogy.mechanisms.length > 0 && (
            <dl className="mt-2 space-y-1.5">
              {analogy.mechanisms.map((mechanism) => {
                const info = ANALOGY_MECHANISMS[mechanism];
                return (
                  <div key={mechanism} className="text-[12.5px] leading-5">
                    <dt className="inline">
                      <ToneBadge tone="critical">{info.label}</ToneBadge>{" "}
                    </dt>
                    <dd className="inline text-muted-foreground">{info.definition}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          {analogy.mechanismExplanation && <p className="mt-2 text-[12.5px] leading-5 text-foreground">{analogy.mechanismExplanation}</p>}
          <p className="mt-2 text-[12.5px] leading-5">
            <span className="font-semibold text-foreground">Suppresses material differences: </span>
            <span className={cn("font-semibold", analogy.suppressesMaterialDifferences ? TONE_CLASSES.critical.text : TONE_CLASSES.positive.text)}>
              {analogy.suppressesMaterialDifferences ? "yes" : "no"}
            </span>
          </p>
          {analogy.conclusion && <p className="mt-1 text-[12.5px] leading-5 text-foreground">{analogy.conclusion}</p>}
          {analogy.rows.length > 0 && (
            <Collapsible open={comparisonOpen} onOpenChange={setComparisonOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="mt-2.5 inline-flex cursor-pointer items-center gap-1 rounded-sm text-[12.5px] font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {comparisonOpen ? "Hide the point-by-point comparison" : "Point-by-point comparison"}
                  <span className="font-normal text-muted-foreground">({analogy.rows.length} dimensions)</span>
                  <ChevronDown className={cn("size-3.5 transition-transform", comparisonOpen && "rotate-180")} aria-hidden="true" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-2 space-y-2" aria-label="Structured comparison">
                  {analogy.rows.map((row) => (
                    <li key={row.dimension} className="rounded-md border border-border bg-card p-2.5 text-[12.5px] leading-5">
                      <p className="font-semibold text-foreground">{COMPARISON_DIMENSIONS[row.dimension]}</p>
                      <dl className="mt-1 space-y-1">
                        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-0.5">
                          <dt className="shrink-0 font-semibold text-muted-foreground">Then</dt>
                          <dd className="flex flex-1 flex-wrap items-baseline gap-1.5 text-foreground">
                            <span>{row.historical}</span>
                            <BasisBadge basis={row.historicalBasis} />
                          </dd>
                        </div>
                        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-0.5">
                          <dt className="shrink-0 font-semibold text-muted-foreground">Now</dt>
                          <dd className="flex flex-1 flex-wrap items-baseline gap-1.5 text-foreground">
                            <span>{row.contemporary}</span>
                            <BasisBadge basis={row.contemporaryBasis} />
                          </dd>
                        </div>
                        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-0.5">
                          <dt className="shrink-0 font-semibold text-muted-foreground">Difference</dt>
                          <dd className="flex-1 text-foreground">
                            {row.difference} <SourceRefs ids={row.sourceIds} sources={ihra.sources} />
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ol>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {ihra.tropeTransfers.map((transfer, index) => (
        <div key={index} className="rounded-md border border-border bg-background p-3">
          <GroupTitle hint={transfer.stereotypePreserved ? "the change of words keeps the stereotype" : "the stereotype is not preserved"}>Classic trope applied to Israel</GroupTitle>
          <div className="mt-1.5">
            <Chain
              steps={[
                { label: "Original antisemitic trope", text: transfer.originalTrope },
                { label: "Lexical or symbolic substitution", text: transfer.substitution },
                { label: "Contemporary target", text: transfer.contemporaryTarget },
              ]}
            />
          </div>
          {transfer.explanation && <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">{transfer.explanation}</p>}
        </div>
      ))}

      {ihra.semanticDisplacements.map((displacement, index) => (
        <div key={index} className="rounded-md border border-border bg-background p-3">
          <GroupTitle>Semantic displacement of Jews</GroupTitle>
          <div className="mt-1.5">
            <Chain
              steps={[
                { label: "Historical referent", text: displacement.historicalReferent },
                { label: "Semantic operation", text: displacement.operation },
                { label: "New referent", text: displacement.newReferent },
                { label: "Informational consequence", text: displacement.consequence },
              ]}
            />
          </div>
        </div>
      ))}

      {ihra.doubleStandard && (
        <div className="rounded-md border border-border bg-background p-3">
          <GroupTitle>Double standard</GroupTitle>
          <dl className="mt-1 space-y-1 text-[12.5px] leading-5">
            <div>
              <dt className="inline font-semibold text-foreground">Comparator: </dt>
              <dd className="inline text-foreground">{ihra.doubleStandard.comparator}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-foreground">Asymmetry: </dt>
              <dd className="inline text-foreground">{ihra.doubleStandard.asymmetry}</dd>
            </div>
          </dl>
        </div>
      )}

      {note && (
        <div className="rounded-md border border-primary/30 bg-accent p-3" aria-label="Community Note 2.0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-foreground">
              <FileText className="size-4" aria-hidden="true" />
              Community Note 2.0
            </span>
            <CopyButton text={note.sources.length ? `${note.text} ${note.sources.map((s) => s.url).join(" ")}` : note.text} label="Copy note" />
          </div>
          <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-foreground">{note.text}</p>
          {note.sources.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {note.sources.map((source) => (
                <SourceItem key={source.id} source={source} compact />
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{COMMUNITY_NOTE_2_EXPLAINER} Nothing is posted for you.</p>
        </div>
      )}

      {ihra.sources.length > 0 && (
        <div>
          <GroupTitle>{ihra.sources.length === 1 ? "Source of the review" : "Sources of the review"}</GroupTitle>
          <ul className="mt-1 space-y-1.5">
            {ihra.sources.map((source) => (
              <li key={source.id} className="flex gap-1.5">
                <span className="shrink-0 pt-px text-[11.5px] font-semibold text-muted-foreground">{source.id}</span>
                <ul className="min-w-0 flex-1">
                  <SourceItem source={source} compact />
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
