import { describe, expect, it } from "vitest";
import { analysisReducer, initialAnalysisState, type AnalysisState } from "@/hooks/useAnalysis";
import { makeAnalysis, makeDraft, samplePost } from "./helpers/analysis";

function loaded(): AnalysisState {
  const loading = analysisReducer(initialAnalysisState, { type: "start", post: samplePost, requestId: 1, startedAt: 1000, attempt: 1 });
  return analysisReducer(loading, { type: "succeed", requestId: 1, analysis: makeAnalysis(), receivedAt: 1420 });
}

describe("analysisReducer", () => {
  it("goes idle -> loading -> result", () => {
    const loading = analysisReducer(initialAnalysisState, { type: "start", post: samplePost, requestId: 1, startedAt: 1000, attempt: 1 });
    expect(loading.status).toBe("loading");
    const result = analysisReducer(loading, { type: "succeed", requestId: 1, analysis: makeAnalysis(), receivedAt: 1420 });
    expect(result.status).toBe("result");
    if (result.status === "result") {
      expect(result.post).toBe(samplePost);
      expect(result.drafts).toEqual({ reply: { status: "idle" }, community_note: { status: "idle" } });
    }
  });

  it("goes loading -> error and keeps the attempt count for retries", () => {
    const loading = analysisReducer(initialAnalysisState, { type: "start", post: samplePost, requestId: 1, startedAt: 1000, attempt: 2 });
    const error = analysisReducer(loading, { type: "fail", requestId: 1, error: { code: "NETWORK", message: "down" } });
    expect(error).toEqual({ status: "error", post: samplePost, error: { code: "NETWORK", message: "down" }, attempt: 2 });
  });

  it("ignores stale responses after a newer request started", () => {
    const first = analysisReducer(initialAnalysisState, { type: "start", post: samplePost, requestId: 1, startedAt: 1000, attempt: 1 });
    const second = analysisReducer(first, { type: "start", post: { ...samplePost, url: "https://x.com/a/status/2" }, requestId: 2, startedAt: 1100, attempt: 1 });
    const stale = analysisReducer(second, { type: "succeed", requestId: 1, analysis: makeAnalysis(), receivedAt: 1500 });
    expect(stale).toBe(second);
    const staleError = analysisReducer(second, { type: "fail", requestId: 1, error: { code: "X", message: "x" } });
    expect(staleError).toBe(second);
  });

  it("runs the draft lifecycle: start -> ready -> edit -> reset -> close", () => {
    let state = loaded();
    state = analysisReducer(state, { type: "draft/start", kind: "reply", requestId: 5 });
    expect(state.status === "result" && state.drafts.reply).toEqual({ status: "loading", requestId: 5 });
    state = analysisReducer(state, { type: "draft/succeed", kind: "reply", requestId: 5, generated: makeDraft("reply", "Hello") });
    expect(state.status === "result" && state.drafts.reply).toMatchObject({ status: "ready", text: "Hello" });
    state = analysisReducer(state, { type: "draft/edit", kind: "reply", text: "Hello edited" });
    expect(state.status === "result" && state.drafts.reply).toMatchObject({ status: "ready", text: "Hello edited" });
    state = analysisReducer(state, { type: "draft/reset", kind: "reply" });
    expect(state.status === "result" && state.drafts.reply).toMatchObject({ status: "ready", text: "Hello" });
    expect(state.status === "result" && state.drafts.community_note).toEqual({ status: "idle" });
    state = analysisReducer(state, { type: "draft/close", kind: "reply" });
    expect(state.status === "result" && state.drafts.reply).toEqual({ status: "idle" });
  });

  it("ignores stale draft responses and draft actions outside the result state", () => {
    let state = loaded();
    state = analysisReducer(state, { type: "draft/start", kind: "community_note", requestId: 7 });
    state = analysisReducer(state, { type: "draft/start", kind: "community_note", requestId: 8 });
    const stale = analysisReducer(state, { type: "draft/succeed", kind: "community_note", requestId: 7, generated: makeDraft("community_note") });
    expect(stale).toBe(state);
    const failed = analysisReducer(state, { type: "draft/fail", kind: "community_note", requestId: 8, error: { code: "E", message: "m" } });
    expect(failed.status === "result" && failed.drafts.community_note).toEqual({ status: "error", error: { code: "E", message: "m" } });
    expect(analysisReducer(initialAnalysisState, { type: "draft/edit", kind: "reply", text: "x" })).toBe(initialAnalysisState);
    expect(analysisReducer(failed, { type: "reset" })).toBe(initialAnalysisState);
  });
});
