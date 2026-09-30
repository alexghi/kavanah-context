import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleHelp, LoaderCircle, RefreshCw, Settings as SettingsIcon, TriangleAlert, X as XIcon } from "lucide-react";
import type { AnalysisMeta, PostContext } from "@kavannah/shared";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { AnalysisClient } from "@/lib/api";
import type { HostTheme } from "@/lib/theme";
import { cn, describeError, formatDuration } from "@/lib/utils";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { AnalysisGuide } from "./AnalysisGuide";
import { AssessmentCard, viewOfAnalysis, viewOfProgress } from "./AssessmentCard";
import { CommunityNoteCard, type NoteRequestState } from "./CommunityNoteCard";
import { EngageCard } from "./EngageCard";
import { PostPreview } from "./PostPreview";
import { StageProgress } from "./StageProgress";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { SectionLabel } from "./SectionLabel";

/** Stands in for a recommendation card until the analysis is complete. */
function RecommendationPending({ question, text }: { question: string; text: string }) {
  return (
    <Card aria-busy="true">
      <CardHeader className="gap-2 pb-4">
        <SectionLabel>{question}</SectionLabel>
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-2/5" />
        </div>
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {text}
        </p>
      </CardHeader>
    </Card>
  );
}

export const PANEL_Z_INDEX = 2147483000;
export const PANEL_WIDTH_PX = 420;

export interface KavannahPanelProps {
  post: PostContext | null;
  client: AnalysisClient;
  /** "drawer": fixed right-side drawer (content script). "embedded": fills its container (popup). */
  variant: "drawer" | "embedded";
  open?: boolean;
  theme?: HostTheme | null;
  /** Inline toast, e.g. when extraction failed. */
  notice?: string | null;
  onDismissNotice?: () => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
  onRequestCommunityNote?: (post: PostContext) => Promise<CommunityNoteMenuStatus>;
  /** True when the caller knows the answer will come from demo fixtures (shows the Demo chip early). */
  demo?: boolean;
}

export function footerText(meta: AnalysisMeta): string {
  if (meta.mode === "mock") return `Demo fixture: ${meta.fixtureId ?? "unknown"}`;
  return `Analyzed in ${formatDuration(meta.durationMs)}${meta.model ? ` · ${meta.model}` : ""}`;
}

export function KavannahPanel({
  post,
  client,
  variant,
  open = true,
  theme = null,
  notice = null,
  onDismissNotice,
  onClose,
  onOpenSettings,
  onRequestCommunityNote,
  demo = false,
}: KavannahPanelProps) {
  const isDrawer = variant === "drawer";
  const { state, analyze, retry, generateDraft, setDraftText, resetDraft, closeDraft } = useAnalysis(client);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(isDrawer && !open);
  const [noteRequest, setNoteRequest] = useState<NoteRequestState>({ status: "idle" });
  const [guideOpen, setGuideOpen] = useState(false);
  const guideRef = useRef<HTMLElement>(null);
  const postUrl = post?.url ?? null;

  useEffect(() => {
    if (post) void analyze(post);
  }, [post, analyze]);

  useEffect(() => {
    setNoteRequest({ status: "idle" });
    const body = bodyRef.current;
    if (body && typeof body.scrollTo === "function") body.scrollTo({ top: 0 });
  }, [postUrl]);

  useLayoutEffect(() => {
    if (!isDrawer) return;
    if (open) {
      setHidden(false);
      const frame = requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setHidden(true), 260);
    return () => clearTimeout(timer);
  }, [open, isDrawer]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && isDrawer && onClose) {
      event.stopPropagation();
      onClose();
    }
  };

  const handleRequestNote = async () => {
    if (!post) return;
    if (!onRequestCommunityNote) {
      setNoteRequest({ status: "not_offered", reason: "no_article" });
      return;
    }
    setNoteRequest({ status: "working" });
    try {
      setNoteRequest(await onRequestCommunityNote(post));
    } catch (err) {
      setNoteRequest({ status: "error", message: describeError(err) });
    }
  };

  const mode = state.status === "result" ? state.analysis.meta.mode : demo ? "mock" : null;
  const showsCurrent = post !== null && state.post?.url === post.url;
  const hasResult = post !== null && showsCurrent && state.status === "result";

  /** Header help button: open "How to read this analysis" and bring it into view. */
  const showGuide = () => {
    setGuideOpen(true);
    requestAnimationFrame(() => {
      const guide = guideRef.current;
      if (!guide) return;
      if (typeof guide.scrollIntoView === "function") guide.scrollIntoView({ behavior: "smooth", block: "start" });
      guide.querySelector("button")?.focus({ preventScroll: true });
    });
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role={isDrawer ? "dialog" : "region"}
      aria-label="Kavannah"
      aria-hidden={isDrawer && !open ? true : undefined}
      inert={isDrawer && !open ? true : undefined}
      data-theme={theme ?? undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "kavannah-root flex flex-col bg-background text-foreground outline-none",
        isDrawer
          ? "fixed inset-y-0 right-0 w-[420px] max-w-[100vw] border-l border-border shadow-[var(--drawer-shadow)] transition-transform duration-200 ease-out motion-reduce:transition-none"
          : "h-full w-full",
        isDrawer && (open ? "translate-x-0" : "translate-x-full"),
      )}
      style={isDrawer ? { zIndex: PANEL_Z_INDEX, visibility: hidden ? "hidden" : "visible" } : undefined}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-4 py-3">
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-[15px] font-bold leading-none text-primary-foreground"
        >
          K
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Kavannah</span>
        {mode === "mock" && <Badge variant="accent">Demo</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {hasResult && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Explain labels and scores"
              title="How to read this analysis"
              onClick={showGuide}
            >
              <CircleHelp aria-hidden="true" />
            </Button>
          )}
          {onOpenSettings && (
            <Button variant="ghost" size="icon" aria-label="Open Kavannah settings" title="Settings" onClick={onOpenSettings}>
              <SettingsIcon aria-hidden="true" />
            </Button>
          )}
          {isDrawer && onClose && (
            <Button variant="ghost" size="icon" aria-label="Close Kavannah panel" title="Close (Esc)" onClick={onClose}>
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      <div ref={bodyRef} className="kavannah-scroll min-h-0 flex-1 overflow-y-auto">
        {notice && (
          <div className="px-3 pt-3" role="status">
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription className="flex items-start justify-between gap-3">
                <span>{notice}</span>
                {onDismissNotice && (
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-[12px] font-medium underline underline-offset-2 hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    onClick={onDismissNotice}
                  >
                    Dismiss
                  </button>
                )}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {post ? (
          <PostPreview post={post} />
        ) : (
          <p className="px-4 py-6 text-center text-[13px] leading-5 text-muted-foreground">
            Click the <span className="font-bold text-link">K</span> button in a post's action bar to analyze it.
          </p>
        )}

        {post && (!showsCurrent || state.status === "idle") && (
          <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Starting analysis…
          </div>
        )}

        {post && showsCurrent && state.status === "loading" && !(state.progress && viewOfProgress(state.progress)) && (
          <StageProgress startedAt={state.startedAt} mode={demo ? "mock" : null} phase={state.progress?.phase} ihraPending={state.progress?.ihraPending} />
        )}

        {post && showsCurrent && state.status === "loading" && state.progress && viewOfProgress(state.progress) && (
          <div className="space-y-3 p-4">
            <StageProgress compact startedAt={state.startedAt} mode={demo ? "mock" : null} phase={state.progress.phase} ihraPending={state.progress.ihraPending} />
            <AssessmentCard view={viewOfProgress(state.progress)!} />
            <RecommendationPending
              question="Should I engage?"
              text={state.progress.ihraPending ? "Deciding once the IHRA review is in…" : "Deciding once the evidence is in…"}
            />
            <RecommendationPending
              question="Should I add a Community Note?"
              text={state.progress.ihraPending ? "Deciding once the IHRA review is in…" : "Deciding once the evidence is in…"}
            />
          </div>
        )}

        {post && showsCurrent && state.status === "error" && (
          <div className="p-4">
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Analysis failed</AlertTitle>
              <AlertDescription>{state.error.message}</AlertDescription>
            </Alert>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => void retry()}>
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
              {onOpenSettings && (
                <Button variant="link" onClick={onOpenSettings}>
                  Open settings
                </Button>
              )}
            </div>
          </div>
        )}

        {hasResult && state.status === "result" && (
          <div className="space-y-3 p-4">
            <AssessmentCard view={viewOfAnalysis(state.analysis)} />
            <EngageCard
              engagement={state.analysis.engagement}
              draft={state.drafts.reply}
              onPrepare={() => void generateDraft("reply")}
              onRegenerate={() => void generateDraft("reply", { regenerate: true })}
              onRetryDraft={() => void generateDraft("reply")}
              onChangeText={(text) => setDraftText("reply", text)}
              onResetDraft={() => resetDraft("reply")}
              onCloseDraft={() => closeDraft("reply")}
            />
            <CommunityNoteCard
              communityNote={state.analysis.communityNote}
              draft={state.drafts.community_note}
              request={noteRequest}
              onPrepare={() => void generateDraft("community_note")}
              onRequest={() => void handleRequestNote()}
              onRegenerate={() => void generateDraft("community_note", { regenerate: true })}
              onRetryDraft={() => void generateDraft("community_note")}
              onChangeText={(text) => setDraftText("community_note", text)}
              onResetDraft={() => resetDraft("community_note")}
              onCloseDraft={() => closeDraft("community_note")}
            />
            <AnalysisGuide open={guideOpen} onOpenChange={setGuideOpen} containerRef={guideRef} />
            <p className="pb-1 text-center text-[12px] text-muted-foreground">{footerText(state.analysis.meta)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
