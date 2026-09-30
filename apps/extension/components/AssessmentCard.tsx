import { TriangleAlert } from "lucide-react";
import type { AnalyzePostResponse, ContentLabel } from "@kavannah/shared";
import { disinfoVerdict, keySources } from "@/lib/decisions";
import { antisemitismCategoryText, CONFIDENCE_TEXT, contentLabelText, joinWords } from "@/lib/labels";
import { DecisionSection } from "./DecisionSection";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, type BadgeProps } from "./ui/badge";
import { EvidenceList, SourceItem } from "./EvidenceList";
import { ScoreMeter } from "./ScoreMeter";

const LABEL_VARIANT: Record<ContentLabel, BadgeProps["variant"]> = {
  factual_claim: "accent",
  opinion: "neutral",
  political_or_historical_argument: "neutral",
  potentially_antisemitic: "critical",
  misinformation: "critical",
  misleading_framing: "caution",
  unverifiable_claim: "caution",
  benign: "positive",
};

export interface AssessmentCardProps {
  analysis: AnalyzePostResponse;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function AssessmentCard({ analysis, open, onOpenChange }: AssessmentCardProps) {
  const { classification, evidence, meta } = analysis;
  const antisemitism = classification.antisemitism;
  const categories = antisemitism.categories.map(antisemitismCategoryText);
  const flagged = antisemitism.assessment !== "not_detected";
  const confidence = `Confidence: ${CONFIDENCE_TEXT[classification.confidence]}`;
  const sources = keySources(evidence);

  return (
    <DecisionSection
      label="Disinfo"
      verdict={disinfoVerdict(classification, evidence)}
      meta={
        <>
          <Badge variant="outline">{confidence}</Badge>
          {flagged && <Badge variant="critical">Antisemitism: {antisemitism.assessment}</Badge>}
        </>
      }
      metaText={flagged ? `${confidence}, antisemitism ${antisemitism.assessment}` : confidence}
      open={open}
      onOpenChange={onOpenChange}
    >
      <h4 className="text-[14px] font-semibold leading-tight tracking-tight">{classification.headline}</h4>

      <ScoreMeter score={classification.disinformationScore} confidence={classification.confidence} />

      <div className="flex flex-wrap gap-1.5" aria-label="Content labels">
        {classification.labels.map((label) => (
          <Badge key={label} variant={LABEL_VARIANT[label] ?? "muted"}>
            {contentLabelText(label)}
          </Badge>
        ))}
      </div>

      {flagged && (
        <div className="rounded-md border border-critical/30 bg-critical-soft p-3 text-[12.5px] leading-5">
          <p className="font-semibold text-critical">
            Antisemitism: {antisemitism.assessment}
            {categories.length > 0 && <> — {joinWords(categories)}</>}
          </p>
          {antisemitism.explanation && <p className="mt-1 text-foreground/90">{antisemitism.explanation}</p>}
        </div>
      )}

      <p className="text-[13px] leading-5 text-foreground/90">{classification.explanation}</p>

      {sources.length > 0 && (
        <div>
          <p className="section-label">Key sources</p>
          <ul className="mt-1.5 space-y-1.5">
            {sources.map((source) => (
              <SourceItem key={source.id} source={source} compact />
            ))}
          </ul>
        </div>
      )}

      <EvidenceList evidence={evidence} />

      {meta.warnings.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            <ul className="space-y-0.5">
              {meta.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </DecisionSection>
  );
}
