import type { AnalysisPreferences, Claim, PostContext } from "@kavannah/shared";
import type { CandidateSource, ModelProvider, ModelResult, SearchOutcome } from "../../ai/provider.js";
import { normalizeUrl } from "../../sources/candidates.js";
import { retrieveEvidencePrompt } from "../prompts.js";

export const MAX_RESEARCHED_CLAIMS = 3;
/** Searches per claim (each claim gets its own parallel research call). */
export const SEARCHES_PER_CLAIM = 2;

/** The claims that go to research: check-worthy ones, at most MAX_RESEARCHED_CLAIMS. */
export function selectClaimsForResearch(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.checkworthy).slice(0, MAX_RESEARCHED_CLAIMS);
}

/**
 * Merges the outcomes of parallel research calls: candidates deduped by URL and re-numbered
 * (s1, s2, …), notes concatenated under one heading per call, counters summed. Fails only when
 * every call failed; partial failures are reported in `toolErrors`.
 */
export function mergeSearchOutcomes(results: Array<{ label: string; result: ModelResult<SearchOutcome> }>): ModelResult<SearchOutcome> {
  const failures = results.filter((r) => !r.result.ok);
  if (results.length > 0 && failures.length === results.length) {
    const first = failures[0]!.result;
    if (first.ok) throw new Error("unreachable");
    return { ...first, retryable: failures.every((f) => !f.result.ok && f.result.retryable) };
  }
  const byKey = new Map<string, CandidateSource>();
  const notes: string[] = [];
  const queries: string[] = [];
  const toolErrors: string[] = [];
  let searches = 0;
  let resumed = 0;
  for (const { label, result } of results) {
    if (!result.ok) {
      toolErrors.push(`${label}: ${result.reason}`);
      continue;
    }
    const outcome = result.value;
    for (const candidate of outcome.candidates) {
      const key = normalizeUrl(candidate.url);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.snippet && candidate.snippet) existing.snippet = candidate.snippet;
        continue;
      }
      byKey.set(key, { ...candidate, id: `s${byKey.size + 1}` });
    }
    if (outcome.notes.trim()) notes.push(`### ${label}\n${outcome.notes.trim()}`);
    queries.push(...outcome.queries);
    toolErrors.push(...outcome.toolErrors);
    searches += outcome.searches;
    resumed += outcome.resumed;
  }
  return { ok: true, value: { candidates: [...byKey.values()], notes: notes.join("\n\n"), searches, queries, toolErrors, resumed } };
}

/**
 * Stage 3: retrieve evidence with the provider's web search, one call per claim in parallel.
 * Candidates are the ONLY allowed sources later.
 */
export async function retrieveEvidence(
  provider: ModelProvider,
  post: PostContext,
  claims: Claim[],
  preferences: AnalysisPreferences | undefined,
): Promise<ModelResult<SearchOutcome>> {
  const results = await Promise.all(
    claims.map(async (claim) => ({
      label: `claim ${claim.id}`,
      result: await provider.search({
        stage: "retrieveEvidence",
        system: retrieveEvidencePrompt.system,
        user: retrieveEvidencePrompt.user(post, [claim], preferences),
        maxUses: SEARCHES_PER_CLAIM,
      }),
    })),
  );
  return mergeSearchOutcomes(results);
}
