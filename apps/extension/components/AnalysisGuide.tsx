import { useId, type ReactNode, type RefObject } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import {
  ANALOGY_MECHANISM_ORDER,
  ANALOGY_MECHANISMS,
  ANTISEMITISM_EXCLUSIONS,
  ANTISEMITISM_LEVELS,
  ANTISEMITISM_NOT_FALSE,
  COMMUNITY_NOTE_COPY,
  CONFIDENCE_EXPLAINER,
  CONFIDENCE_LEVELS,
  CONTENT_LABELS,
  ENGAGEMENT_COPY,
  EVIDENCE_VERDICTS,
  IHRA_PATTERN_ORDER,
  IHRA_PATTERNS,
  IHRA_REVIEW_EXPLAINER,
  LABEL_GROUPS,
  MANIPULATION_SIGNAL_ORDER,
  MANIPULATION_SIGNALS,
  MANIPULATION_SIGNALS_EXPLAINER,
  QUESTIONS,
  QUESTIONS_INDEPENDENT,
  SCORE_BANDS,
  SCORE_DISCLAIMER,
  SOURCES_EXPLAINER,
  STATEMENT_BASIS,
  UNVERIFIED_LINK_EXPLAINER,
  VERDICT_ORDER,
  type AntisemitismLevel,
  type CommunityNoteRecommendation,
  type Confidence,
  type ContentLabel,
  type EngagementRecommendation,
} from "@kavannah/shared";
import { FACTUAL_VERDICTS, VERDICT_EXPLAINER } from "@/lib/decisions";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { IhraLink } from "./AntisemitismDetails";
import { LabelChip } from "./LabelList";
import { ENGAGE_STATUS, NOTE_STATUS, StatusMark } from "./RecommendationStatus";
import { GroupTitle } from "./SubSection";
import { Badge, ToneBadge } from "./ui/badge";
import { Card } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const ENGAGE_ORDER: EngagementRecommendation[] = ["engage", "do_not_engage", "uncertain"];
const NOTE_ORDER: CommunityNoteRecommendation[] = ["recommended", "not_recommended", "uncertain"];
const LEVEL_ORDER: AntisemitismLevel[] = ["likely", "possible", "not_detected"];
const CONFIDENCE_ORDER: Confidence[] = ["high", "medium", "low"];
const BANDS_ASC = [...SCORE_BANDS].sort((a, b) => a.min - b.min);
const labelsIn = (group: "finding" | "type") =>
  (Object.keys(CONTENT_LABELS) as ContentLabel[]).filter((id) => CONTENT_LABELS[id].group === group);

function GuideSection({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2.5 border-t border-border pt-4">
      <h4 id={id} className="text-[13px] font-semibold text-foreground">
        {title}
      </h4>
      {intro && <p className="text-[12.5px] leading-5 text-muted-foreground">{intro}</p>}
      {children}
    </section>
  );
}

/** Term (a chip or a short name) above its definition. */
function Terms({ items }: { items: Array<{ key: string; term: ReactNode; definition: ReactNode }> }) {
  return (
    <dl className="space-y-2.5">
      {items.map((item) => (
        <div key={item.key}>
          <dt className="text-[12.5px] font-semibold leading-5 text-foreground">{item.term}</dt>
          <dd className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{item.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusTerm({ status, children }: { status: Parameters<typeof StatusMark>[0]["status"]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusMark status={status} small />
      {children}
    </span>
  );
}

/** "How to read this analysis": every category the panel can show, with the same chips it uses. */
export function AnalysisGuide({
  open,
  onOpenChange,
  containerRef,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Card ref={containerRef} aria-label="How to read this analysis">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-4 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <BookOpen className="size-4 shrink-0 text-link" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-foreground">How to read this analysis</span>
              <span className="block text-[12px] leading-5 text-muted-foreground">
                What every label, score, level and verdict means
              </span>
            </span>
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 px-4 pb-4">
            <GuideSection title="The two questions" intro={QUESTIONS_INDEPENDENT}>
              <div className="space-y-3">
                <div>
                  <GroupTitle hint={QUESTIONS.engage.explainer}>{QUESTIONS.engage.title}</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={ENGAGE_ORDER.map((value) => ({
                        key: value,
                        term: <StatusTerm status={ENGAGE_STATUS[value]}>{ENGAGEMENT_COPY[value].title}</StatusTerm>,
                        definition: ENGAGEMENT_COPY[value].description,
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <GroupTitle hint={QUESTIONS.communityNote.explainer}>{QUESTIONS.communityNote.title}</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={NOTE_ORDER.map((value) => ({
                        key: value,
                        term: <StatusTerm status={NOTE_STATUS[value]}>{COMMUNITY_NOTE_COPY[value].short}</StatusTerm>,
                        definition: COMMUNITY_NOTE_COPY[value].description,
                      }))}
                    />
                  </div>
                </div>
              </div>
            </GuideSection>

            <GuideSection title="Labels" intro="A post can carry several labels, in two groups.">
              <div className="space-y-3">
                {(["finding", "type"] as const).map((group) => (
                  <div key={group}>
                    <GroupTitle hint={LABEL_GROUPS[group].description}>{LABEL_GROUPS[group].title}</GroupTitle>
                    <div className="mt-1.5">
                      <Terms
                        items={labelsIn(group).map((id) => ({
                          key: id,
                          term: <LabelChip item={CONTENT_LABELS[id]} />,
                          definition: CONTENT_LABELS[id].definition,
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </GuideSection>

            <GuideSection title="Verdict" intro={VERDICT_EXPLAINER}>
              <Terms
                items={(Object.keys(FACTUAL_VERDICTS) as Array<keyof typeof FACTUAL_VERDICTS>).map((label) => ({
                  key: label,
                  term: label,
                  definition: FACTUAL_VERDICTS[label],
                }))}
              />
            </GuideSection>

            <GuideSection title="Manipulation signals" intro={MANIPULATION_SIGNALS_EXPLAINER}>
              <Terms
                items={MANIPULATION_SIGNAL_ORDER.map((id) => ({
                  key: id,
                  term: <ToneBadge tone="caution">{MANIPULATION_SIGNALS[id].label}</ToneBadge>,
                  definition: MANIPULATION_SIGNALS[id].definition,
                }))}
              />
              <p className="text-[12.5px] leading-5 text-muted-foreground">{SCORE_DISCLAIMER}</p>
              <Terms
                items={BANDS_ASC.map((band) => ({
                  key: String(band.min),
                  term: (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className={cn("size-2.5 rounded-[3px]", TONE_CLASSES[band.tone].fill)} />
                      <span className="tabular-nums">
                        {band.min}–{band.max}
                      </span>
                      <ToneBadge tone={band.tone}>{band.label}</ToneBadge>
                    </span>
                  ),
                  definition: band.meaning,
                }))}
              />
            </GuideSection>

            <GuideSection title="AI confidence" intro={CONFIDENCE_EXPLAINER}>
              <Terms
                items={CONFIDENCE_ORDER.map((value) => ({
                  key: value,
                  term: <Badge variant="neutral">{CONFIDENCE_LEVELS[value].label}</Badge>,
                  definition: CONFIDENCE_LEVELS[value].definition,
                }))}
              />
            </GuideSection>

            <GuideSection
              title="Antisemitism"
              intro={
                <>
                  Judged against the <IhraLink />. {ANTISEMITISM_EXCLUSIONS} {ANTISEMITISM_NOT_FALSE}
                </>
              }
            >
              <div className="space-y-3">
                <div>
                  <GroupTitle>Levels</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={LEVEL_ORDER.map((value) => ({
                        key: value,
                        term: <ToneBadge tone={ANTISEMITISM_LEVELS[value].tone}>{ANTISEMITISM_LEVELS[value].label}</ToneBadge>,
                        definition: ANTISEMITISM_LEVELS[value].definition,
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <GroupTitle hint={IHRA_REVIEW_EXPLAINER}>IHRA patterns</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={IHRA_PATTERN_ORDER.map((pattern) => {
                        const info = IHRA_PATTERNS[pattern];
                        return { key: pattern, term: info.number ? `${info.number}. ${info.label}` : info.label, definition: info.definition };
                      })}
                    />
                  </div>
                </div>
                <div>
                  <GroupTitle hint="how a Nazi or Holocaust analogy works; several can apply at once">Analogy mechanisms</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={ANALOGY_MECHANISM_ORDER.map((mechanism) => ({
                        key: mechanism,
                        term: <ToneBadge tone="critical">{ANALOGY_MECHANISMS[mechanism].label}</ToneBadge>,
                        definition: ANALOGY_MECHANISMS[mechanism].definition,
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <GroupTitle hint="shown on every statement of a comparison">Fact or interpretation</GroupTitle>
                  <div className="mt-1.5">
                    <Terms
                      items={(Object.keys(STATEMENT_BASIS) as Array<keyof typeof STATEMENT_BASIS>).map((basis) => ({
                        key: basis,
                        term: <Badge variant={STATEMENT_BASIS[basis].tone}>{STATEMENT_BASIS[basis].label}</Badge>,
                        definition: STATEMENT_BASIS[basis].definition,
                      }))}
                    />
                  </div>
                </div>
              </div>
            </GuideSection>

            <GuideSection title="Evidence" intro={SOURCES_EXPLAINER}>
              <Terms
                items={[
                  ...VERDICT_ORDER.map((value) => ({
                    key: value,
                    term: <ToneBadge tone={EVIDENCE_VERDICTS[value].tone}>{EVIDENCE_VERDICTS[value].label}</ToneBadge>,
                    definition: EVIDENCE_VERDICTS[value].definition,
                  })),
                  {
                    key: "unverified",
                    term: <ToneBadge tone="caution">Unverified link</ToneBadge>,
                    definition: UNVERIFIED_LINK_EXPLAINER,
                  },
                ]}
              />
            </GuideSection>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
