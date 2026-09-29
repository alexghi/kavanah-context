import { TriangleAlert } from "lucide-react";
import type { AnalyzePostResponse, ContentLabel } from "@kavannah/shared";
import { antisemitismCategoryText, contentLabelText, joinWords } from "@/lib/labels";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, type BadgeProps } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { EvidenceList } from "./EvidenceList";
import { ScoreMeter } from "./ScoreMeter";
import { SectionLabel } from "./SectionLabel";

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

export function AssessmentCard({ analysis }: { analysis: AnalyzePostResponse }) {
  const { classification, evidence, meta } = analysis;
  const antisemitism = classification.antisemitism;
  const categories = antisemitism.categories.map(antisemitismCategoryText);

  return (
    <Card aria-labelledby="kavannah-assessment-title">
      <CardHeader className="pb-3">
        <SectionLabel>Content assessment</SectionLabel>
        <CardTitle id="kavannah-assessment-title">{classification.headline}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScoreMeter score={classification.disinformationScore} confidence={classification.confidence} />

        <div className="flex flex-wrap gap-1.5" aria-label="Content labels">
          {classification.labels.map((label) => (
            <Badge key={label} variant={LABEL_VARIANT[label] ?? "muted"}>
              {contentLabelText(label)}
            </Badge>
          ))}
        </div>

        {antisemitism.assessment !== "not_detected" && (
          <div className="rounded-md border border-critical/30 bg-critical-soft p-3 text-[12.5px] leading-5">
            <p className="font-semibold text-critical">
              Antisemitism: {antisemitism.assessment}
              {categories.length > 0 && <> — {joinWords(categories)}</>}
            </p>
            {antisemitism.explanation && <p className="mt-1 text-foreground/90">{antisemitism.explanation}</p>}
          </div>
        )}

        <p className="text-[13px] leading-5 text-foreground/90">{classification.explanation}</p>

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
      </CardContent>
    </Card>
  );
}
