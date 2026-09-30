import { FileSearch, Gauge, LoaderCircle, MessageSquareText, ShieldAlert, Tags, TriangleAlert } from "lucide-react";
import {
  ANTISEMITISM_LEVELS,
  CONFIDENCE_LEVELS,
  IHRA_REVIEW_EXPLAINER,
  type AnalysisProgress,
  type AnalyzePostResponse,
  type Claim,
  type Classification,
  type EvidenceItem,
  type IhraAssessment,
} from "@kavannah/shared";
import { AntisemitismDetails } from "./AntisemitismDetails";
import { EvidenceList } from "./EvidenceList";
import { IhraReview } from "./IhraReview";
import { LabelList } from "./LabelList";
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

/**
 * The content assessment: headline and AI confidence, then one titled part per signal
 * (score, labels, antisemitism, reasoning, evidence), each explained where it appears. Parts
 * that are still being computed show a pending state, so the card is useful before the end.
 */
export function AssessmentCard({ view }: { view: AssessmentView }) {
  const { classification, evidence, ihra, ihraPending, warnings } = view;
  const confidence = CONFIDENCE_LEVELS[classification.confidence];
  const antisemitismLevel = ANTISEMITISM_LEVELS[classification.antisemitism.assessment];

  return (
    <Card aria-labelledby="kavannah-assessment-title">
      <CardHeader className="gap-2 pb-3.5">
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
        >
          <ScoreMeter score={classification.disinformationScore} />
        </SubSection>

        <SubSection icon={Tags} title="Labels">
          <LabelList labels={classification.labels} />
        </SubSection>

        <SubSection
          icon={ShieldAlert}
          title="Antisemitism"
          aside={
            <span className="inline-flex items-center gap-1.5">
              {ihraPending && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
              <ToneBadge tone={antisemitismLevel.tone}>{antisemitismLevel.label}</ToneBadge>
            </span>
          }
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
              <div className="border-t border-border pt-3">
                <IhraReview ihra={ihra} />
              </div>
            )}
          </div>
        </SubSection>

        <SubSection icon={MessageSquareText} title="Why this assessment">
          <p className="text-[13px] leading-5 text-foreground">{classification.explanation}</p>
        </SubSection>

        <SubSection icon={FileSearch} title="Evidence">
          {evidence ? <EvidenceList evidence={evidence} /> : <Pending text="Checking the post's claims against sources…" />}
        </SubSection>

        {warnings.length > 0 && (
          <div className="p-4">
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
