import { FileSearch, Gauge, LoaderCircle, MessageSquareText, ShieldAlert, Tags, TriangleAlert } from "lucide-react";
import {
  ANTISEMITISM_LEVELS,
  CONFIDENCE_LEVELS,
  IHRA_REVIEW_EXPLAINER,
  scoreBand,
  type AnalysisProgress,
  type AnalyzePostResponse,
  type Claim,
  type Classification,
  type EvidenceItem,
  type IhraAssessment,
} from "@kavannah/shared";
import { disinfoVerdict, keySources } from "@/lib/decisions";
import { TONE_ICON } from "@/lib/tone";
import { AntisemitismDetails } from "./AntisemitismDetails";
import { DecisionSection } from "./DecisionSection";
import { EvidenceList, SourceItem } from "./EvidenceList";
import { IhraReview } from "./IhraReview";
import { LabelList } from "./LabelList";
import { ScoreLegend, ScoreSummary } from "./ScoreMeter";
import { GroupTitle, SubSection } from "./SubSection";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, ToneBadge } from "./ui/badge";
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

export interface AssessmentCardProps {
  view: AssessmentView;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * The "Disinfo" decision. Always visible: the verdict, the score with its scale and the AI
 * confidence. Behind the disclosure: the headline, then one titled part per signal (score
 * legend, labels, antisemitism, reasoning, evidence), each explained where it appears. Parts
 * that are still being computed show a pending state, so the card is useful before the end.
 */
export function AssessmentCard({ view, open, onOpenChange }: AssessmentCardProps) {
  const { classification, evidence, ihra, ihraPending, warnings } = view;
  const confidence = CONFIDENCE_LEVELS[classification.confidence];
  const antisemitismLevel = ANTISEMITISM_LEVELS[classification.antisemitism.assessment];
  const flagged = classification.antisemitism.assessment !== "not_detected";
  const verdict = disinfoVerdict(classification, evidence ?? []);
  const sources = keySources(evidence ?? []);
  const confidenceText = `AI confidence: ${confidence.label}`;

  return (
    <DecisionSection
      label="Disinfo"
      verdict={verdict}
      status={{ Icon: TONE_ICON[verdict.tone], tone: verdict.tone }}
      metaText={flagged ? `${confidenceText}, antisemitism ${antisemitismLevel.label}` : confidenceText}
      summary={
        <div className="space-y-2.5">
          <ScoreSummary
            score={classification.disinformationScore}
            hideBand={scoreBand(classification.disinformationScore).label === verdict.label}
            aside={
              <>
                <span className="text-[12px] font-semibold text-foreground">AI confidence:</span>
                <Badge variant="neutral">{confidence.label}</Badge>
              </>
            }
          />
          {flagged && <ToneBadge tone={antisemitismLevel.tone}>Antisemitism: {antisemitismLevel.label}</ToneBadge>}
        </div>
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="space-y-1.5 px-4 py-3.5">
        <h4 className="text-[15px] font-semibold leading-snug tracking-tight">{classification.headline}</h4>
        <p className="text-[12.5px] leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">{confidenceText}.</span> {confidence.definition}
        </p>
      </div>

      <div className="divide-y divide-border border-t border-border">
        <SubSection
          icon={Gauge}
          title="Disinformation score"
          aside={<span className="text-[11.5px] font-medium text-muted-foreground">AI estimate</span>}
        >
          <ScoreLegend score={classification.disinformationScore} />
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
          {evidence ? (
            <div className="space-y-3">
              {sources.length > 0 && (
                <div>
                  <GroupTitle>Key sources</GroupTitle>
                  <ul className="mt-1 space-y-1.5">
                    {sources.map((source) => (
                      <SourceItem key={source.id} source={source} compact />
                    ))}
                  </ul>
                </div>
              )}
              <EvidenceList evidence={evidence} />
            </div>
          ) : (
            <Pending text="Checking the post's claims against sources…" />
          )}
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
    </DecisionSection>
  );
}
