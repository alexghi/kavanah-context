import { CircleCheck, CircleHelp, CircleMinus, type LucideIcon } from "lucide-react";
import type { CommunityNoteRecommendation, EngagementRecommendation, Tone } from "@kavannah/shared";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";

export interface RecommendationStatus {
  Icon: LucideIcon;
  tone: Tone;
}

/** Same visual language for both questions, so neither recommendation outranks the other. */
export const ENGAGE_STATUS: Record<EngagementRecommendation, RecommendationStatus> = {
  engage: { Icon: CircleCheck, tone: "positive" },
  do_not_engage: { Icon: CircleMinus, tone: "neutral" },
  uncertain: { Icon: CircleHelp, tone: "caution" },
};

export const NOTE_STATUS: Record<CommunityNoteRecommendation, RecommendationStatus> = {
  recommended: { Icon: CircleCheck, tone: "positive" },
  not_recommended: { Icon: CircleMinus, tone: "neutral" },
  uncertain: { Icon: CircleHelp, tone: "caution" },
};

export function StatusMark({ status, small = false }: { status: RecommendationStatus; small?: boolean }) {
  const tone = TONE_CLASSES[status.tone];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border",
        small ? "size-5" : "size-8",
        tone.soft,
        tone.line,
      )}
    >
      <status.Icon className={cn(small ? "size-3.5" : "size-5", tone.text)} />
    </span>
  );
}
