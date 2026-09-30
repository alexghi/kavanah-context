import { CircleCheck, CircleHelp, CircleMinus, type LucideIcon } from "lucide-react";
import type { CommunityNoteRecommendation, EngagementRecommendation, Tone } from "@kavannah/shared";
import { LoaderCircle } from "lucide-react";
import { TONE_CLASSES } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";
import { Card, CardHeader } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

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

/** A recommendation card's frame while the analysis runs: same place, same size as the answer to come. */
export function RecommendationSkeleton({ question, text }: { question: string; text: string }) {
  return (
    <Card aria-busy="true">
      <CardHeader className="gap-2 pb-4">
        <SectionLabel>{question}</SectionLabel>
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-2/5" />
        </div>
        <Skeleton className="h-3 w-4/5" />
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground" role="status">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {text}
        </p>
      </CardHeader>
    </Card>
  );
}
