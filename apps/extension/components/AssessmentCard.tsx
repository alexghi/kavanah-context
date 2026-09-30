import { FileSearch, Gauge, LoaderCircle, Megaphone, MessageSquareText, ShieldAlert, Tags, TriangleAlert } from "lucide-react";
import {
  ANTISEMITISM_LEVELS,
  CONFIDENCE_LEVELS,
  IHRA_REVIEW_EXPLAINER,
  MANIPULATION_LEVELS,
  type AnalysisProgress,
  type AnalyzePostResponse,
  type Claim,
  type Classification,
  type EvidenceItem,
  type IhraAssessment,
} from "@kavannah/shared";
import { useArrival } from "@/hooks/useArrival";
import { cn } from "@/lib/utils";
import { AntisemitismDetails } from "./AntisemitismDetails";
import { EvidenceList } from "./EvidenceList";
import { IhraReview } from "./IhraReview";
import { LabelList } from "./LabelList";
import { ManipulationDetails } from "./ManipulationDetails";
import { ScoreMeter } from "./ScoreMeter";
import { SectionLabel } from "./SectionLabel";
import { SubSection } from "./SubSection";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, ToneBadge } from "./ui/badge";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

/** What the card shows: a finished analysis, or the parts that have arrived so far. */
export interface AssessmentView {
  classification: Classification;
  claims?: Claim[];
  /** undefined while the claims are still being checked */
  evidence?: EvidenceItem[];
  ihra?: IhraAssessment;
  /** The full IHRA review is still running */
  ihraPending: boolean;
  warnings: string[];
}

export function viewOfAnalysis(analysis: AnalyzePostResponse): AssessmentView {
  const view: AssessmentView = { classification: analysis.classification, claims: analysis.claims, evidence: analysis.evidence, ihraPending: false, warnings: analysis.meta.warnings };
  if (analysis.ihra) view.ihra = analysis.ihra;
  return view;
}

export function viewOfProgress(progress: AnalysisProgress): AssessmentView | null {
  if (!progress.classification) return null;
  const view: AssessmentView = { classification: progress.classification, ihraPending: progress.ihraPending, warnings: progress.warnings };
  if (progress.claims) view.claims = progress.claims;
  if (progress.evidence) view.evidence = progress.evidence;
  if (progress.ihra) view.ihra = progress.ihra;
  return view;
}

function Pending({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        {text}
      </p>
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

/** Placeholder lines of roughly the height the real content will take, so nothing moves when it lands. */
function Lines({ widths, height = "h-3", gap = "space-y-2" }: { widths: string[]; height?: string; gap?: string }) {
  return (
    <div className={gap}>
      {widths.map((width, i) => (
        <Skeleton key={i} className={cn(height, width)} />
      ))}
    </div>
  );
}

/** The card's frame with placeholders, shown from the first moment until the classification arrives. */
function AssessmentSkeleton() {
  return (
    <Card aria-labelledby="kavannah-assessment-title" aria-busy="true">
      <CardHeader className="gap-2 pb-3.5">
        <SectionLabel>Content assessment</SectionLabel>
        <CardTitle id="kavannah-assessment-title" className="text-[17px] leading-snug">
          <span className="sr-only-text">Assessment in progress</span>
          {/* Two lines: a headline of 3-8 words usually wraps once at this width. */}
          <span className="block space-y-1.5">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </span>
        </CardTitle>
        {/* The confidence line: chip plus a one-sentence definition, two lines at this width. */}
        <Lines widths={["w-full", "w-1/2"]} height="h-3.5" gap="space-y-3" />
      </CardHeader>
      <div className="divide-y divide-border border-t border-border">
        <SubSection icon={Gauge} title="Disinformation score">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-5 w-32" />
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Lines widths={["w-11/12", "w-4/5"]} />
          </div>
        </SubSection>
        <SubSection icon={Tags} title="Labels">
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        </SubSection>
        <SubSection icon={Megaphone} title="Manipulation">
          <Lines widths={["w-full", "w-2/3"]} />
        </SubSection>
        <SubSection icon={ShieldAlert} title="Antisemitism">
          <Lines widths={["w-full", "w-3/4"]} />
        </SubSection>
        <SubSection icon={MessageSquareText} title="Why this assessment">
          <Lines widths={["w-full", "w-full", "w-2/3"]} />
        </SubSection>
        <SubSection icon={FileSearch} title="Evidence">
          <Lines widths={["w-4/5", "w-3/5"]} />
        </SubSection>
      </div>
    </Card>
  );
}

/**
 * The content assessment: headline and AI confidence, then one titled part per signal
 * (score, labels, antisemitism, reasoning, evidence), each explained where it appears. The frame
 * is on screen from the start; each part settles into its place as it arrives and breathes once.
 */
export function AssessmentCard({ view }: { view: AssessmentView | null }) {
  const cardArrived = useArrival(view !== null);
  const evidenceArrived = useArrival(Boolean(view?.evidence));
  const ihraArrived = useArrival(Boolean(view?.ihra));
  if (!view) return <AssessmentSkeleton />;

  const { classification, evidence, ihra, ihraPending, warnings } = view;
  const confidence = CONFIDENCE_LEVELS[classification.confidence];
  const antisemitismLevel = ANTISEMITISM_LEVELS[classification.antisemitism.assessment];
  const manipulation = classification.manipulation;
  const manipulationLevel = manipulation ? MANIPULATION_LEVELS[manipulation.level] : null;

  return (
    <Card aria-labelledby="kavannah-assessment-title" className={cn(cardArrived && "kavannah-breathe")}>
      <CardHeader className="kavannah-settle gap-2 pb-3.5">
        <SectionLabel>Content assessment</SectionLabel>
        <CardTitle id="kavannah-assessment-title" className="text-[17px] leading-snug">
          {classification.headline}
        </CardTitle>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-5">
          <span className="font-semibold text-foreground">AI confidence:</span>
          <Badge variant="neutral">{confidence.label}</Badge>
          <span className="text-muted-foreground">{confidence.definition}</span>
        </p>
      </CardHeader>

      <div className="divide-y divide-border border-t border-border">
        <SubSection
          icon={Gauge}
          title="Disinformation score"
          aside={<span className="text-[11.5px] font-medium text-muted-foreground">AI estimate</span>}
          className="kavannah-settle"
        >
          <ScoreMeter score={classification.disinformationScore} />
        </SubSection>

        <SubSection icon={Tags} title="Labels" className="kavannah-settle">
          <LabelList labels={classification.labels} />
        </SubSection>

        {manipulation && manipulationLevel && (
          <SubSection
            icon={Megaphone}
            title="Manipulation"
            aside={<ToneBadge tone={manipulationLevel.tone}>{manipulationLevel.label}</ToneBadge>}
            className="kavannah-settle"
          >
            <ManipulationDetails manipulation={manipulation} />
          </SubSection>
        )}

        <SubSection
          icon={ShieldAlert}
          title="Antisemitism"
          aside={
            <span className="inline-flex items-center gap-1.5">
              {ihraPending && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
              <ToneBadge tone={antisemitismLevel.tone}>{antisemitismLevel.label}</ToneBadge>
            </span>
          }
          className={cn("kavannah-settle", ihraArrived && "kavannah-breathe rounded-md")}
        >
          <div className="space-y-4">
            <AntisemitismDetails antisemitism={classification.antisemitism} />
            {ihraPending && !ihra && (
              <div className="rounded-md border border-border bg-background p-3">
                <Pending text="Full IHRA review in progress: checking each pattern against the post's context and the historical record…" />
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{IHRA_REVIEW_EXPLAINER}</p>
              </div>
            )}
            {ihra && (
              <div className="kavannah-settle border-t border-border pt-3">
                <IhraReview ihra={ihra} />
              </div>
            )}
          </div>
        </SubSection>

        <SubSection icon={MessageSquareText} title="Why this assessment" className="kavannah-settle">
          <p className="text-[13px] leading-5 text-foreground">{classification.explanation}</p>
        </SubSection>

        <SubSection icon={FileSearch} title="Evidence" className={cn(evidenceArrived && "kavannah-breathe rounded-md")}>
          {evidence ? (
            <div className="kavannah-settle">
              <EvidenceList evidence={evidence} />
            </div>
          ) : (
            <Pending text="Checking the post's claims against sources…" />
          )}
        </SubSection>

        {warnings.length > 0 && (
          <div className="kavannah-settle p-4">
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                <ul className="space-y-0.5">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </Card>
  );
}
