import { MessageSquare } from "lucide-react";
import { ENGAGEMENT_COPY, type Engagement } from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import { useArrival } from "@/hooks/useArrival";
import { engageVerdict } from "@/lib/decisions";
import { cn } from "@/lib/utils";
import { DecisionSection } from "./DecisionSection";
import { DraftEditor } from "./DraftEditor";
import { ENGAGE_STATUS, RecommendationSkeleton } from "./RecommendationStatus";
import { GroupTitle } from "./SubSection";
import { Button } from "./ui/button";

export interface EngageCardProps {
  /** null while the analysis is still running: the card keeps its place with a placeholder. */
  engagement: Engagement | null;
  pendingText?: string;
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
  pendingText,
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
  const arrived = useArrival(engagement !== null);
  if (!engagement) return <RecommendationSkeleton label="Engage" text={pendingText ?? "Deciding once the evidence is in…"} />;
  const recommendation = engagement.recommendation;
  const copy = ENGAGEMENT_COPY[recommendation];

  return (
    <DecisionSection
      label="Engage"
      verdict={engageVerdict(recommendation)}
      status={ENGAGE_STATUS[recommendation]}
      open={open}
      onOpenChange={onOpenChange}
      className={cn(arrived && "kavannah-breathe")}
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
