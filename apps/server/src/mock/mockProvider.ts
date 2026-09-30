import type { AnalysisProgress, AnalyzeOptions, AnalyzePostResponse, DraftRequest, DraftResponse, Fixture, PostContext, Source } from "@kavannah/shared";
import { NO_SOURCE_WARNING } from "../lib/analysis/draft.js";
import { FIXTURES } from "./fixtures.js";

export const MOCK_WARNING = "Demo output from a built-in fixture, not a live analysis.";
export const GENERIC_FIXTURE_ID = "generic";
export const GENERIC_WARNING = "Demo output: the post did not match any built-in fixture, so no real analysis was performed.";
export const GENERIC_DRAFT_WARNING = "Demo output: no fixture draft exists for this post, so a generic draft was composed from the analysis.";
export const FUZZY_JACCARD_THRESHOLD = 0.5;
export const FUZZY_CONTAINMENT_THRESHOLD = 0.8;
export const DEFAULT_MOCK_DELAY_MS: [number, number] = [300, 800];

export interface MockOptions {
  /** Simulated latency range in ms (default 300-800). Use [0, 0] in tests. */
  delayMs?: [number, number];
  now?: () => Date;
  random?: () => number;
  /** Progressive delivery: the demo answer is revealed in the same steps as a live analysis. */
  onProgress?: (progress: AnalysisProgress) => void;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersectionSize(a, b);
  return inter / (a.size + b.size - inter);
}

/** Share of the smaller token set contained in the larger one. */
export function containment(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  return intersectionSize(a, b) / smaller;
}

export interface FixtureMatch {
  fixture: Fixture;
  via: "id" | "url" | "text";
  score: number;
}

function normalizeUrlLoose(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?(twitter|x)\.com/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

/** Exact id/URL match first, then normalized-text similarity, else null. */
export function matchFixture(post: PostContext, fixtures: Fixture[] = FIXTURES): FixtureMatch | null {
  if (post.id) {
    const byId = fixtures.find((f) => f.post.id === post.id);
    if (byId) return { fixture: byId, via: "id", score: 1 };
  }
  const url = normalizeUrlLoose(post.url);
  const byUrl = fixtures.find((f) => normalizeUrlLoose(f.post.url) === url);
  if (byUrl) return { fixture: byUrl, via: "url", score: 1 };

  const tokens = tokenize(post.text);
  let best: FixtureMatch | null = null;
  for (const fixture of fixtures) {
    const other = tokenize(fixture.post.text);
    const j = jaccard(tokens, other);
    const c = containment(tokens, other);
    const qualifies = j >= FUZZY_JACCARD_THRESHOLD || (c >= FUZZY_CONTAINMENT_THRESHOLD && Math.min(tokens.size, other.size) >= 5);
    if (!qualifies) continue;
    const score = Math.max(j, c);
    if (!best || score > best.score) best = { fixture, via: "text", score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function pickDelay(options: MockOptions): number {
  const [min, max] = options.delayMs ?? DEFAULT_MOCK_DELAY_MS;
  const rnd = options.random ?? Math.random;
  return Math.max(0, Math.round(min + (max - min) * rnd()));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reveals a finished analysis in steps: classification and claims, then evidence, then the IHRA review. */
async function revealProgressively(analysis: AnalyzePostResponse, totalMs: number, started: number, onProgress: (progress: AnalysisProgress) => void): Promise<void> {
  const ihraPending = Boolean(analysis.ihra);
  const base = () => ({ post: analysis.post, classification: analysis.classification, claims: analysis.claims, stages: analysis.meta.stages, warnings: analysis.meta.warnings, elapsedMs: Date.now() - started });
  const steps: Array<{ at: number; progress: () => AnalysisProgress }> = [
    { at: 0.3, progress: () => ({ phase: "checking_evidence", ihraPending, ...base() }) },
    { at: 0.6, progress: () => ({ phase: ihraPending ? "reviewing_ihra" : "recommending", ihraPending, evidence: analysis.evidence, ...base() }) },
  ];
  if (analysis.ihra) steps.push({ at: 0.85, progress: () => ({ phase: "recommending", ihraPending: false, evidence: analysis.evidence, ihra: analysis.ihra, ...base() }) });
  let elapsed = 0;
  for (const step of steps) {
    const target = Math.round(totalMs * step.at);
    await sleep(target - elapsed);
    elapsed = target;
    onProgress(step.progress());
  }
  await sleep(totalMs - elapsed);
}

export function buildGenericAnalysis(post: PostContext, analyzedAt: string, durationMs: number): AnalyzePostResponse {
  return {
    post,
    classification: {
      headline: "Not analyzed (demo mode)",
      labels: ["unverifiable_claim"],
      explanation:
        "This is demo output from mock mode. The post did not match any built-in fixture, so no real analysis was performed: nothing here is an assessment of the post. Turn off mock mode (and provide an API key) for a live analysis.",
      confidence: "low",
      disinformationScore: 0,
      antisemitism: { assessment: "not_detected", categories: [], explanation: "Not assessed in demo mode." },
    },
    claims: [],
    evidence: [],
    engagement: { recommendation: "uncertain", rationale: "Demo mode: the post did not match a built-in fixture, so no recommendation can be made." },
    communityNote: { recommendation: "uncertain", rationale: "Demo mode: the post did not match a built-in fixture, so no recommendation can be made." },
    meta: {
      version: 1,
      mode: "mock",
      model: "fixture",
      fixtureId: GENERIC_FIXTURE_ID,
      analyzedAt,
      durationMs,
      stages: [{ name: "mock", ms: durationMs, ok: true, note: "no matching fixture" }],
      warnings: [MOCK_WARNING, GENERIC_WARNING],
    },
  };
}

/** Mock analysis: fixture match → fixture analysis; else a generic, clearly-labelled demo result. */
export async function mockAnalyze(post: PostContext, _options: AnalyzeOptions | undefined, mock: MockOptions = {}): Promise<AnalyzePostResponse> {
  const now = mock.now ?? (() => new Date());
  const started = Date.now();
  const waited = pickDelay(mock);
  const match = matchFixture(post);
  const build = (analyzedAt: string): AnalyzePostResponse => {
    if (!match) return buildGenericAnalysis(post, analyzedAt, waited);
    const analysis = structuredClone(match.fixture.analysis);
    return {
      ...analysis,
      post, // echo the post that was actually sent (may differ slightly from the fixture on fuzzy matches)
      meta: {
        ...analysis.meta,
        mode: "mock",
        fixtureId: match.fixture.id,
        analyzedAt,
        durationMs: waited,
        warnings: [MOCK_WARNING, ...analysis.meta.warnings.filter((w) => w !== MOCK_WARNING)],
      },
    };
  };
  if (mock.onProgress) await revealProgressively(build(now().toISOString()), waited, started, mock.onProgress);
  else await sleep(waited);
  return build(now().toISOString());
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function analysisSources(analysis: AnalyzePostResponse): Source[] {
  const byId = new Map<string, Source>();
  for (const item of analysis.evidence) for (const s of item.sources) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => Number(b.verified) - Number(a.verified));
}

function citedSources(text: string, sources: Source[]): Source[] {
  return sources.filter((s) => text.includes(s.url));
}

function composeGenericDraft(request: DraftRequest): { text: string; sources: Source[] } {
  const sources = analysisSources(request.analysis);
  const informative = request.analysis.evidence.find((e) => e.verdict !== "insufficient_evidence" && e.verdict !== "not_a_factual_claim");
  if (request.kind === "reply") {
    if (informative) {
      const url = sources.find((s) => s.verified)?.url ?? sources[0]?.url;
      const text = `${informative.summary}${url ? ` ${url}` : ""}`;
      return { text, sources: citedSources(text, sources) };
    }
    return { text: "Do you have a source for this? I could not find one that confirms it.", sources: [] };
  }
  if (informative) {
    const urls = sources.slice(0, 2).map((s) => s.url);
    const text = `${informative.summary}${urls.length ? ` ${urls.join(" ")}` : ""}`;
    return { text, sources: citedSources(text, sources) };
  }
  return { text: "This post does not make a specific factual claim that a Community Note could address with sources.", sources: [] };
}

/** Mock draft: the fixture's draft when one exists, else a generic draft composed from the analysis. */
export async function mockDraft(request: DraftRequest, mock: MockOptions = {}): Promise<DraftResponse> {
  const delay = async (options: MockOptions): Promise<number> => {
    const ms = pickDelay(options);
    await sleep(ms);
    return ms;
  };
  const waited = await delay(mock);
  const fixtureId = request.analysis.meta.fixtureId;
  const fixture = (fixtureId && fixtureId !== GENERIC_FIXTURE_ID ? FIXTURES.find((f) => f.id === fixtureId) : undefined) ?? matchFixture(request.post)?.fixture;
  const warnings: string[] = [MOCK_WARNING];
  let text: string;
  let sources: Source[];

  const fixtureText = fixture?.drafts[request.kind];
  if (fixtureText) {
    text = fixtureText;
    sources = citedSources(text, analysisSources(request.analysis).length ? analysisSources(request.analysis) : analysisSources(fixture.analysis));
  } else {
    const composed = composeGenericDraft(request);
    text = composed.text;
    sources = composed.sources;
    warnings.push(GENERIC_DRAFT_WARNING);
  }
  if (request.kind === "community_note" && sources.length === 0) warnings.push(NO_SOURCE_WARNING);

  return { kind: request.kind, text, sources, warnings, meta: { mode: "mock", model: "fixture", durationMs: waited } };
}
