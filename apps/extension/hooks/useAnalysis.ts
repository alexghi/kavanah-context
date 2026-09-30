import { useCallback, useReducer, useRef } from "react";
import type { AnalysisProgress, AnalyzePostResponse, DraftKind, DraftResponse, PostContext } from "@kavannah/shared";
import type { AnalysisClient } from "@/lib/api";

/**
 * Analysis state machine: idle -> loading -> result | error, with retry and per-kind draft
 * generation. The reducer is pure (unit-tested); the hook wires it to an injected client.
 */

export interface ErrorInfo {
  code: string;
  message: string;
}

export type DraftState =
  | { status: "idle" }
  | { status: "loading"; requestId: number }
  | { status: "ready"; generated: DraftResponse; text: string }
  | { status: "error"; error: ErrorInfo };

export type DraftStates = Record<DraftKind, DraftState>;

export type AnalysisState =
  | { status: "idle"; post: null }
  | { status: "loading"; post: PostContext; requestId: number; startedAt: number; attempt: number; progress?: AnalysisProgress }
  | {
      status: "result";
      post: PostContext;
      analysis: AnalyzePostResponse;
      drafts: DraftStates;
      receivedAt: number;
      attempt: number;
    }
  | { status: "error"; post: PostContext; error: ErrorInfo; attempt: number };

export type AnalysisAction =
  | { type: "start"; post: PostContext; requestId: number; startedAt: number; attempt: number }
  | { type: "progress"; requestId: number; progress: AnalysisProgress }
  | { type: "succeed"; requestId: number; analysis: AnalyzePostResponse; receivedAt: number }
  | { type: "fail"; requestId: number; error: ErrorInfo }
  | { type: "draft/start"; kind: DraftKind; requestId: number }
  | { type: "draft/succeed"; kind: DraftKind; requestId: number; generated: DraftResponse }
  | { type: "draft/fail"; kind: DraftKind; requestId: number; error: ErrorInfo }
  | { type: "draft/edit"; kind: DraftKind; text: string }
  | { type: "draft/reset"; kind: DraftKind }
  | { type: "draft/close"; kind: DraftKind }
  | { type: "reset" };

export const initialAnalysisState: AnalysisState = { status: "idle", post: null };

export const emptyDrafts = (): DraftStates => ({ reply: { status: "idle" }, community_note: { status: "idle" } });

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case "start":
      return {
        status: "loading",
        post: action.post,
        requestId: action.requestId,
        startedAt: action.startedAt,
        attempt: action.attempt,
      };
    case "progress":
      if (state.status !== "loading" || state.requestId !== action.requestId) return state; // stale
      return { ...state, progress: action.progress };
    case "succeed":
      if (state.status !== "loading" || state.requestId !== action.requestId) return state; // stale
      return {
        status: "result",
        post: state.post,
        analysis: action.analysis,
        drafts: emptyDrafts(),
        receivedAt: action.receivedAt,
        attempt: state.attempt,
      };
    case "fail":
      if (state.status !== "loading" || state.requestId !== action.requestId) return state; // stale
      return { status: "error", post: state.post, error: action.error, attempt: state.attempt };
    case "draft/start":
      if (state.status !== "result") return state;
      return { ...state, drafts: { ...state.drafts, [action.kind]: { status: "loading", requestId: action.requestId } } };
    case "draft/succeed": {
      if (state.status !== "result") return state;
      const current = state.drafts[action.kind];
      if (current.status !== "loading" || current.requestId !== action.requestId) return state; // stale
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.kind]: { status: "ready", generated: action.generated, text: action.generated.text },
        },
      };
    }
    case "draft/fail": {
      if (state.status !== "result") return state;
      const current = state.drafts[action.kind];
      if (current.status !== "loading" || current.requestId !== action.requestId) return state; // stale
      return { ...state, drafts: { ...state.drafts, [action.kind]: { status: "error", error: action.error } } };
    }
    case "draft/edit": {
      if (state.status !== "result") return state;
      const current = state.drafts[action.kind];
      if (current.status !== "ready") return state;
      return { ...state, drafts: { ...state.drafts, [action.kind]: { ...current, text: action.text } } };
    }
    case "draft/reset": {
      if (state.status !== "result") return state;
      const current = state.drafts[action.kind];
      if (current.status !== "ready") return state;
      return { ...state, drafts: { ...state.drafts, [action.kind]: { ...current, text: current.generated.text } } };
    }
    case "draft/close":
      if (state.status !== "result") return state;
      return { ...state, drafts: { ...state.drafts, [action.kind]: { status: "idle" } } };
    case "reset":
      return initialAnalysisState;
    default:
      return state;
  }
}

export interface AnalyzeCallOptions {
  /** Re-run even when this post already has a result / is loading. */
  force?: boolean;
  /** Ask the backend to bypass its cache. */
  refresh?: boolean;
}

export interface UseAnalysis {
  state: AnalysisState;
  analyze(post: PostContext, options?: AnalyzeCallOptions): Promise<void>;
  retry(): Promise<void>;
  generateDraft(kind: DraftKind, options?: { regenerate?: boolean }): Promise<void>;
  setDraftText(kind: DraftKind, text: string): void;
  resetDraft(kind: DraftKind): void;
  closeDraft(kind: DraftKind): void;
  reset(): void;
}

export function useAnalysis(client: AnalysisClient): UseAnalysis {
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const counter = useRef(0);
  // URL of the post whose analysis is in flight (set synchronously, so two calls in the same tick dedupe).
  const inFlightUrl = useRef<string | null>(null);

  const analyze = useCallback(
    async (post: PostContext, options: AnalyzeCallOptions = {}) => {
      const current = stateRef.current;
      const samePost = current.post?.url === post.url;
      if (!options.force && samePost && (current.status === "loading" || current.status === "result")) return;
      if (!options.force && inFlightUrl.current === post.url) return;
      const requestId = ++counter.current;
      inFlightUrl.current = post.url;
      const attempt = samePost && current.status !== "idle" ? current.attempt + 1 : 1;
      dispatch({ type: "start", post, requestId, startedAt: Date.now(), attempt });
      const response = await client.analyze(post, options.refresh ? { refresh: true } : undefined, (progress) =>
        dispatch({ type: "progress", requestId, progress }),
      );
      if (counter.current === requestId) inFlightUrl.current = null;
      if (response.ok) dispatch({ type: "succeed", requestId, analysis: response.data, receivedAt: Date.now() });
      else dispatch({ type: "fail", requestId, error: response.error });
    },
    [client],
  );

  const retry = useCallback(async () => {
    const current = stateRef.current;
    if (current.post) await analyze(current.post, { force: true, refresh: true });
  }, [analyze]);

  const generateDraft = useCallback(
    async (kind: DraftKind, options: { regenerate?: boolean } = {}) => {
      const current = stateRef.current;
      if (current.status !== "result") return;
      const requestId = ++counter.current;
      dispatch({ type: "draft/start", kind, requestId });

      // A draft already shipped with the analysis needs no extra model call.
      const pregenerated =
        kind === "reply" ? current.analysis.engagement.draftReply : current.analysis.communityNote.draft;
      if (!options.regenerate && pregenerated) {
        dispatch({
          type: "draft/succeed",
          kind,
          requestId,
          generated: {
            kind,
            text: pregenerated,
            sources: [],
            warnings: [],
            meta: { mode: current.analysis.meta.mode, model: current.analysis.meta.model, durationMs: 0 },
          },
        });
        return;
      }

      const response = await client.draft({
        post: current.post,
        analysis: current.analysis,
        kind,
        options: options.regenerate ? { refresh: true } : undefined,
      });
      if (response.ok) dispatch({ type: "draft/succeed", kind, requestId, generated: response.data });
      else dispatch({ type: "draft/fail", kind, requestId, error: response.error });
    },
    [client],
  );

  const setDraftText = useCallback((kind: DraftKind, text: string) => dispatch({ type: "draft/edit", kind, text }), []);
  const resetDraft = useCallback((kind: DraftKind) => dispatch({ type: "draft/reset", kind }), []);
  const closeDraft = useCallback((kind: DraftKind) => dispatch({ type: "draft/close", kind }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { state, analyze, retry, generateDraft, setDraftText, resetDraft, closeDraft, reset };
}
