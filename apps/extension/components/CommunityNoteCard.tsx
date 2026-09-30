import { useState } from "react";
import { ChevronDown, CircleCheck, ExternalLink, FilePen, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  COMMUNITY_NOTE_COPY,
  COMMUNITY_NOTES_GUIDE_URL,
  COMMUNITY_NOTES_HUB_URL,
  HELPFUL_NOTE_ATTRIBUTES,
  type CommunityNote,
} from "@kavannah/shared";
import type { DraftState } from "@/hooks/useAnalysis";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { cn } from "@/lib/utils";
import { noteVerdict } from "@/lib/decisions";
import { DecisionSection } from "./DecisionSection";
import { DraftEditor } from "./DraftEditor";
import { NOTE_STATUS } from "./RecommendationStatus";
import { GroupTitle } from "./SubSection";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export type NoteRequestState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string }
  | CommunityNoteMenuStatus;

export interface CommunityNoteCardProps {
  communityNote: CommunityNote;
  draft: DraftState;
  request: NoteRequestState;
  open: boolean;
  onOpenChange(open: boolean): void;
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
            className="font-semibold underline underline-offset-2 hover:no-underline"
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
  open,
  onOpenChange,
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
  const working = request.status === "working";

  return (
    <DecisionSection
      label="Note"
      verdict={noteVerdict(recommendation)}
      status={NOTE_STATUS[recommendation]}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="space-y-3 p-4">
        <p className="text-[12.5px] leading-5 text-muted-foreground">{copy.description}</p>
        <div>
          <GroupTitle>Why</GroupTitle>
          <p className="mt-0.5 text-[13px] leading-5 text-foreground">{communityNote.rationale}</p>
        </div>

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
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              What makes a helpful note
              <ChevronDown className={cn("size-3 transition-transform", guideOpen && "rotate-180")} aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] leading-5 text-foreground">
              {HELPFUL_NOTE_ATTRIBUTES.map((attribute) => (
                <li key={attribute}>{attribute}</li>
              ))}
            </ul>
            <a
              href={COMMUNITY_NOTES_GUIDE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Official Community Notes guide
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </DecisionSection>
  );
}
