import { useState } from "react";
import { ChevronDown, CircleCheck, CircleHelp, CircleMinus, ExternalLink, FilePen, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  COMMUNITY_NOTE_COPY,
  COMMUNITY_NOTES_GUIDE_URL,
  COMMUNITY_NOTES_HUB_URL,
  HELPFUL_NOTE_ATTRIBUTES,
  type CommunityNote,
  type CommunityNoteRecommendation,
} from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { cn } from "@/lib/utils";
import { DraftEditor } from "./DraftEditor";
import { SectionLabel } from "./SectionLabel";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export type NoteRequestState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string }
  | CommunityNoteMenuStatus;

export const NOTE_STATUS: Record<
  CommunityNoteRecommendation,
  { Icon: typeof CircleCheck; iconClass: string; bgClass: string }
> = {
  recommended: { Icon: CircleCheck, iconClass: "text-positive", bgClass: "bg-positive-soft" },
  not_recommended: { Icon: CircleMinus, iconClass: "text-neutral", bgClass: "bg-neutral-soft" },
  uncertain: { Icon: CircleHelp, iconClass: "text-caution", bgClass: "bg-caution-soft" },
};

export interface CommunityNoteCardProps {
  communityNote: CommunityNote;
  draft: DraftState;
  request: NoteRequestState;
  onPrepare(): void;
  onRequest(): void;
  onRegenerate(): void;
  onRetryDraft(): void;
  onChangeText(text: string): void;
  onResetDraft(): void;
  onCloseDraft(): void;
}

function RequestFeedback({ request }: { request: NoteRequestState }) {
  if (request.status === "idle" || request.status === "working") return null;
  if (request.status === "highlighted") {
    return (
      <Alert variant="positive">
        <CircleCheck aria-hidden="true" />
        <AlertDescription>
          Highlighted “{request.label}” in the post's ••• menu. Choose it there to continue — Kavannah never submits
          anything for you.
        </AlertDescription>
      </Alert>
    );
  }
  if (request.status === "not_offered") {
    return (
      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertDescription>
          X didn't offer a Community Note option for this post. You can open the{" "}
          <a
            href={COMMUNITY_NOTES_HUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium underline underline-offset-2 hover:text-primary"
          >
            Community Notes hub
          </a>{" "}
          instead.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription>{request.message}</AlertDescription>
    </Alert>
  );
}

export function CommunityNoteCard({
  communityNote,
  draft,
  request,
  onPrepare,
  onRequest,
  onRegenerate,
  onRetryDraft,
  onChangeText,
  onResetDraft,
  onCloseDraft,
}: CommunityNoteCardProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const recommendation = communityNote.recommendation;
  const copy = COMMUNITY_NOTE_COPY[recommendation];
  const status = NOTE_STATUS[recommendation];
  const working = request.status === "working";

  return (
    <Card aria-labelledby="kavannah-note-title">
      <CardHeader className="pb-3">
        <SectionLabel>Should I add a Community Note?</SectionLabel>
        <div className="flex items-center gap-2.5">
          <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", status.bgClass)}>
            <status.Icon className={cn("size-5", status.iconClass)} aria-hidden="true" />
          </span>
          <CardTitle id="kavannah-note-title" className="text-[17px]">
            {copy.title}
          </CardTitle>
        </div>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] leading-5 text-foreground/90">{communityNote.rationale}</p>

        <div className="flex flex-wrap gap-2">
          {draft.status === "idle" && (
            <Button variant={recommendation === "recommended" ? "default" : "outline"} onClick={onPrepare}>
              <FilePen aria-hidden="true" />
              Prepare Community Note
            </Button>
          )}
          <Button variant="secondary" onClick={onRequest} disabled={working} aria-busy={working || undefined}>
            {working ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
            Request a Community Note
          </Button>
        </div>

        <RequestFeedback request={request} />

        {draft.status !== "idle" && (
          <DraftEditor
            kind="community_note"
            state={draft}
            onChange={onChangeText}
            onRegenerate={onRegenerate}
            onReset={onResetDraft}
            onRetry={onRetryDraft}
            onClose={onCloseDraft}
          />
        )}

        <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              What makes a helpful note
              <ChevronDown className={cn("size-3 transition-transform", guideOpen && "rotate-180")} aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] leading-5 text-muted-foreground">
              {HELPFUL_NOTE_ATTRIBUTES.map((attribute) => (
                <li key={attribute}>{attribute}</li>
              ))}
            </ul>
            <a
              href={COMMUNITY_NOTES_GUIDE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[12px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Official Community Notes guide
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
