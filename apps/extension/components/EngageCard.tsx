import { MessageSquare } from "lucide-react";
import { ENGAGEMENT_COPY, type Engagement } from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import { engageVerdict } from "@/lib/decisions";
import { DecisionSection } from "./DecisionSection";
import { DraftEditor } from "./DraftEditor";
import { ENGAGE_STATUS } from "./RecommendationStatus";
import { GroupTitle } from "./SubSection";
import { Button } from "./ui/button";

export interface EngageCardProps {
  engagement: Engagement;
  draft: DraftState;
  open: boolean;
  onOpenChange(open: boolean): void;
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
  open,
  onOpenChange,
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
    <DecisionSection
      label="Engage"
      verdict={engageVerdict(recommendation)}
      status={ENGAGE_STATUS[recommendation]}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="space-y-3 p-4">
        <p className="text-[12.5px] leading-5 text-muted-foreground">{copy.description}</p>
        <div>
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
      </div>
    </DecisionSection>
  );
}
