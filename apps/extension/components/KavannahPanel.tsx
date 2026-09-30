import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CircleHelp, RefreshCw, Settings as SettingsIcon, TriangleAlert, X as XIcon } from "lucide-react";
import type { AnalysisMeta, DraftKind, PostContext } from "@kavannah/shared";
import { useAnalysis } from "@/hooks/useAnalysis";
import type { AnalysisClient } from "@/lib/api";
import { ALL_CLOSED, type DecisionId } from "@/lib/decisions";
import type { HostTheme } from "@/lib/theme";
import { cn, describeError, formatDuration } from "@/lib/utils";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { AnalysisGuide } from "./AnalysisGuide";
import { AssessmentCard, viewOfAnalysis, viewOfProgress } from "./AssessmentCard";
import { CommunityNoteCard, type NoteRequestState } from "./CommunityNoteCard";
import { EngageCard } from "./EngageCard";
import { PostPreview } from "./PostPreview";
import { ProgressStrip } from "./StageProgress";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

/** The note draft for X's request form: the text, or a promise of it while it is being written (`null` = drafting failed). */
export type NoteExplanation = string | Promise<string | null>;

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
  /** Run X's Community Note request flow; with `explanation`, open X's form and fill it. */
  onRequestCommunityNote?: (post: PostContext, explanation?: NoteExplanation) => Promise<CommunityNoteMenuStatus>;
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
  const [openSections, setOpenSections] = useState(ALL_CLOSED);
  // Drafts already started automatically, so closing one and reopening its section doesn't regenerate it.
  const autoDrafted = useRef(new Set<string>());
  // "Request a Community Note" was pressed before the draft existed: X's form is already open and
  // these are called with the draft (or null if drafting failed) once it settles.
  const draftWaiters = useRef<Array<(text: string | null) => void>>([]);
  const settleDraftWaiters = (text: string | null) => {
    for (const resolve of draftWaiters.current.splice(0)) resolve(text);
  };
  const guideRef = useRef<HTMLElement>(null);
  const postUrl = post?.url ?? null;

  useEffect(() => {
    if (post) void analyze(post);
  }, [post, analyze]);

  useEffect(() => {
    setNoteRequest({ status: "idle" });
    settleDraftWaiters(null);
    setOpenSections(ALL_CLOSED);
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

  const runNoteRequest = async (explanation: NoteExplanation) => {
    if (!post || !onRequestCommunityNote) return;
    setNoteRequest({ status: "working" });
    try {
      setNoteRequest(await onRequestCommunityNote(post, explanation));
    } catch (err) {
      setNoteRequest({ status: "error", message: describeError(err) });
    }
  };

  /**
   * X's request form opens at once and is filled with the note draft (as edited). Without a
   * draft yet, it is written while the form is open, which shows a "writing…" marker meanwhile.
   */
  const handleRequestNote = () => {
    if (!post) return;
    if (!onRequestCommunityNote) {
      setNoteRequest({ status: "not_offered", reason: "no_article" });
      return;
    }
    if (state.status !== "result") return;
    const draft = state.drafts.community_note;
    if (draft.status === "ready") {
      void runNoteRequest(draft.text);
      return;
    }
    void runNoteRequest(new Promise<string | null>((resolve) => draftWaiters.current.push(resolve)));
    if (draft.status !== "loading") void generateDraft("community_note");
  };

  const noteDraft = state.status === "result" ? state.drafts.community_note : null;
  useEffect(() => {
    if (!noteDraft || noteDraft.status === "loading") return;
    // Ready: hand over the text. Failed or closed: X's form stays empty and the panel says why.
    settleDraftWaiters(noteDraft.status === "ready" ? noteDraft.text : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on draft status changes only
  }, [noteDraft?.status]);

  // Opening a section whose answer is "yes" shows its draft straight away; otherwise the draft stays on demand.
  const handleSectionChange = (id: DecisionId, sectionOpen: boolean) => {
    setOpenSections((current) => ({ ...current, [id]: sectionOpen }));
    if (!sectionOpen || id === "disinfo" || state.status !== "result") return;
    const kind: DraftKind = id === "engage" ? "reply" : "community_note";
    const recommended =
      kind === "reply"
        ? state.analysis.engagement.recommendation === "engage"
        : state.analysis.communityNote.recommendation === "recommended";
    const key = `${state.post.url}|${state.receivedAt}|${kind}`;
    if (!recommended || state.drafts[kind].status !== "idle" || autoDrafted.current.has(key)) return;
    autoDrafted.current.add(key);
    void generateDraft(kind);
  };
  const disinfoSection = { open: openSections.disinfo, onOpenChange: (sectionOpen: boolean) => handleSectionChange("disinfo", sectionOpen) };

  const mode = state.status === "result" ? state.analysis.meta.mode : demo ? "mock" : null;
  const showsCurrent = post !== null && state.post?.url === post.url;
  const hasResult = post !== null && showsCurrent && state.status === "result";
  // One tree for the whole life of an analysis: the same cards fill in place, nothing is re-mounted.
  const analysis = hasResult && state.status === "result" ? state.analysis : null;
  const inFlight = post !== null && (!showsCurrent || state.status === "idle" || state.status === "loading");
  const progress = showsCurrent && state.status === "loading" ? state.progress : undefined;
  const view = analysis ? viewOfAnalysis(analysis) : progress ? viewOfProgress(progress) : null;
  const openedAt = useMemo(() => Date.now(), [postUrl]);
  const startedAt = showsCurrent && state.status === "loading" ? state.startedAt : showsCurrent && state.status === "result" ? state.receivedAt - state.analysis.meta.durationMs : openedAt;
  const pendingText = progress?.ihraPending ? "Deciding once the IHRA review is in…" : "Deciding once the evidence is in…";
  const idleDrafts = { status: "idle" } as const;

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

        {post && !showsCurrent && (
          <span className="sr-only-text" role="status">
            Starting analysis…
          </span>
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

        {post && (inFlight || analysis) && (
          <div className="p-4">
            <ProgressStrip
              startedAt={startedAt}
              finishedAt={analysis && state.status === "result" ? state.receivedAt : undefined}
              mode={demo ? "mock" : null}
              phase={progress?.phase}
              ihraPending={progress?.ihraPending ?? false}
            />
            <div className="space-y-3">
            <AssessmentCard view={view} {...disinfoSection} />
            <EngageCard
              engagement={analysis?.engagement ?? null}
              pendingText={pendingText}
              draft={state.status === "result" ? state.drafts.reply : idleDrafts}
              open={openSections.engage}
              onOpenChange={(sectionOpen) => handleSectionChange("engage", sectionOpen)}
              onPrepare={() => void generateDraft("reply")}
              onRegenerate={() => void generateDraft("reply", { regenerate: true })}
              onRetryDraft={() => void generateDraft("reply")}
              onChangeText={(text) => setDraftText("reply", text)}
              onResetDraft={() => resetDraft("reply")}
              onCloseDraft={() => closeDraft("reply")}
            />
            <CommunityNoteCard
              communityNote={analysis?.communityNote ?? null}
              pendingText={pendingText}
              draft={state.status === "result" ? state.drafts.community_note : idleDrafts}
              request={noteRequest}
              open={openSections.note}
              onOpenChange={(sectionOpen) => handleSectionChange("note", sectionOpen)}
              onPrepare={() => void generateDraft("community_note")}
              onRequest={handleRequestNote}
              onRegenerate={() => void generateDraft("community_note", { regenerate: true })}
              onRetryDraft={() => void generateDraft("community_note")}
              onChangeText={(text) => setDraftText("community_note", text)}
              onResetDraft={() => resetDraft("community_note")}
              onCloseDraft={() => closeDraft("community_note")}
            />
            {analysis && (
              <div className="kavannah-settle space-y-3">
                <AnalysisGuide open={guideOpen} onOpenChange={setGuideOpen} containerRef={guideRef} />
                <p className="pb-1 text-center text-[12px] text-muted-foreground">{footerText(analysis.meta)}</p>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
