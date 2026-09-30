import { MessageSquare } from "lucide-react";
import { ENGAGEMENT_COPY, type Engagement } from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import { DraftEditor } from "./DraftEditor";
import { ENGAGE_STATUS, StatusMark } from "./RecommendationStatus";
import { SectionLabel } from "./SectionLabel";
import { GroupTitle } from "./SubSection";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export interface EngageCardProps {
  engagement: Engagement;
  draft: DraftState;
  onPrepare(): void;
  onRegenerate(): void;
  onRetryDraft(): void;
  onChangeText(text: string): void;
  onResetDraft(): void;
  onCloseDraft(): void;
}

export function EngageCard({
  engagement,
  draft,
  onPrepare,
  onRegenerate,
  onRetryDraft,
  onChangeText,
  onResetDraft,
  onCloseDraft,
}: EngageCardProps) {
  const recommendation = engagement.recommendation;
  const copy = ENGAGEMENT_COPY[recommendation];

  return (
    <Card aria-labelledby="kavannah-engage-title">
      <CardHeader className="pb-3">
        <SectionLabel>Should I engage?</SectionLabel>
        <div className="flex items-center gap-2.5">
          <StatusMark status={ENGAGE_STATUS[recommendation]} />
          <CardTitle id="kavannah-engage-title" className="text-[17px]">
            {copy.title}
          </CardTitle>
        </div>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="border-t border-border pt-3">
          <GroupTitle>Why</GroupTitle>
          <p className="mt-0.5 text-[13px] leading-5 text-foreground">{engagement.rationale}</p>
        </div>
        {draft.status === "idle" ? (
          <Button variant={recommendation === "engage" ? "default" : "outline"} onClick={onPrepare}>
            <MessageSquare aria-hidden="true" />
            Prepare reply
          </Button>
        ) : (
          <DraftEditor
            kind="reply"
            state={draft}
            onChange={onChangeText}
            onRegenerate={onRegenerate}
            onReset={onResetDraft}
            onRetry={onRetryDraft}
            onClose={onCloseDraft}
          />
        )}
      </CardContent>
    </Card>
  );
}
