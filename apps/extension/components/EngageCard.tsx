import { CircleCheck, CircleHelp, CircleMinus, MessageSquare } from "lucide-react";
import { ENGAGEMENT_COPY, type Engagement, type EngagementRecommendation } from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import { cn } from "@/lib/utils";
import { DraftEditor } from "./DraftEditor";
import { SectionLabel } from "./SectionLabel";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export const ENGAGE_STATUS: Record<
  EngagementRecommendation,
  { Icon: typeof CircleCheck; iconClass: string; bgClass: string }
> = {
  engage: { Icon: CircleCheck, iconClass: "text-positive", bgClass: "bg-positive-soft" },
  do_not_engage: { Icon: CircleMinus, iconClass: "text-neutral", bgClass: "bg-neutral-soft" },
  uncertain: { Icon: CircleHelp, iconClass: "text-caution", bgClass: "bg-caution-soft" },
};

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
  const status = ENGAGE_STATUS[recommendation];

  return (
    <Card aria-labelledby="kavannah-engage-title">
      <CardHeader className="pb-3">
        <SectionLabel>Should I engage?</SectionLabel>
        <div className="flex items-center gap-2.5">
          <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", status.bgClass)}>
            <status.Icon className={cn("size-5", status.iconClass)} aria-hidden="true" />
          </span>
          <CardTitle id="kavannah-engage-title" className="text-[17px]">
            {copy.title}
          </CardTitle>
        </div>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] leading-5 text-foreground/90">{engagement.rationale}</p>
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
