import { AnalyzePostResponseSchema } from "@kavannah/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUTS, DEFAULT_SEARCH, FakeProvider, TEST_POST, fakeValidateUrl } from "../../test/fakeProvider.js";
import {
  AnalysisFailedError,
  EVIDENCE_ASSESSMENT_FAILED_SUMMARY,
  EVIDENCE_NONE_RETRIEVED_SUMMARY,
  EVIDENCE_UNAVAILABLE_SUMMARY,
  WARNINGS,
  analyzePost,
} from "./analyzePost.js";

const fail = (reason: "refusal" | "invalid_output" | "rate_limited" | "auth" | "api_error" | "timeout", message = "boom") => ({ ok: false as const, reason, message });

async function run(provider: FakeProvider) {
  const response = await analyzePost(TEST_POST, { preferences: { trustedDomains: ["example.org"] } }, { provider, validateUrl: fakeValidateUrl });
  // Every path must produce a response that validates against the shared contract.
  return AnalyzePostResponseSchema.parse(response);
}

describe("analyzePost — happy path", () => {
  it("runs all stages, sets meta and produces a valid response", async () => {
    const provider = new FakeProvider();
    const r = await run(provider);
    expect(r.meta.version).toBe(1);
    expect(r.meta.mode).toBe("live");
    expect(r.meta.model).toBe("fake-model");
    expect(Date.parse(r.meta.analyzedAt)).not.toBeNaN();
    expect(r.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.meta.stages.map((s) => s.name)).toEqual([
      "extractClaims",
      "classifyContent",
      "retrieveEvidence",
      "verifySources",
      "assessEvidence",
      "assessIhra",
      "recommendEngagement",
      "recommendCommunityNote",
    ]);
    expect(r.meta.stages.find((s) => s.name === "assessIhra")?.note).toContain("skipped");
    expect(r.ihra).toBeUndefined();
    expect(r.meta.stages.every((s) => s.ok)).toBe(true);
    expect(r.meta.warnings).toContain(WARNINGS.droppedSourceIds); // s99 from the default assessment
    expect(r.claims.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(r.claims[1]?.checkworthy).toBe(false);
    expect(r.classification.disinformationScore).toBe(80);
  });

  it("calls 5a and 5b independently: separate prompts, neither sees the other's answer, and they can disagree", async () => {
    const provider = new FakeProvider();
    const r = await run(provider);
    const engagement = provider.callsFor("recommendEngagement");
    const note = provider.callsFor("recommendCommunityNote");
    expect(engagement).toHaveLength(1);
    expect(note).toHaveLength(1);
    expect(engagement[0]!.system).not.toBe(note[0]!.system);
    // Neither prompt contains the other stage's output.
    expect(engagement[0]!.user).not.toContain("NOTE-RATIONALE");
    expect(engagement[0]!.system).not.toContain("NOTE-RATIONALE");
    expect(note[0]!.user).not.toContain("ENGAGEMENT-RATIONALE");
    expect(note[0]!.system).not.toContain("ENGAGEMENT-RATIONALE");
    // The key product outcome: do not engage, but a note is recommended.
    expect(r.engagement.recommendation).toBe("do_not_engage");
    expect(r.communityNote.recommendation).toBe("recommended");
  });

  it("drops source ids that were not retrieved and flags verification from the URL check", async () => {
    const provider = new FakeProvider({
      structured: {
        assessEvidence: {
          ok: true,
          value: {
            assessments: [
              {
                claimId: "c1",
                verdict: "contradicted",
                summary: "s",
                sources: [
                  { id: "s1", whyItMatters: "why 1" },
                  { id: "s2", whyItMatters: "why 2" },
                  { id: "made-up", whyItMatters: "hallucinated" },
                  { id: "s1", whyItMatters: "duplicate" },
                ],
              },
            ],
          },
        },
      },
    });
    const r = await run(provider);
    const item = r.evidence[0]!;
    expect(item.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(item.sources[0]).toMatchObject({ verified: true, retrievedVia: "web_search", url: "https://example.org/moon", snippet: "The Moon is made of rock.", whyItMatters: "why 1" });
    expect(item.sources[1]).toMatchObject({ verified: false, url: "https://example.org/other" });
    expect(r.meta.warnings).toContain(WARNINGS.droppedSourceIds);
    expect(r.meta.warnings).toContain(WARNINGS.unverifiedSources(1));
    expect(r.meta.stages.find((s) => s.name === "verifySources")?.note).toBe("1/2 URLs verified");
  });

  it("downgrades a sourced verdict to insufficient_evidence when no retrieved source survives", async () => {
    const provider = new FakeProvider({
      structured: {
        assessEvidence: { ok: true, value: { assessments: [{ claimId: "c1", verdict: "supported", summary: "trust me", sources: [{ id: "nope", whyItMatters: "x" }] }] } },
      },
    });
    const r = await run(provider);
    expect(r.evidence[0]?.verdict).toBe("insufficient_evidence");
    expect(r.evidence[0]?.sources).toEqual([]);
  });

  it("fills in claims the assessment forgot and researches at most 3 check-worthy factual claims", async () => {
    const provider = new FakeProvider({
      structured: {
        extractClaims: {
          ok: true,
          value: {
            claims: [
              { text: "A", type: "factual", checkworthy: true, reason: "" },
              { text: "B", type: "factual", checkworthy: true, reason: "" },
              { text: "C", type: "opinion", checkworthy: true, reason: "opinion marked checkworthy by mistake" },
              { text: "D", type: "factual", checkworthy: true, reason: "" },
              { text: "E", type: "factual", checkworthy: true, reason: "" },
            ],
          },
        },
        assessEvidence: { ok: true, value: { assessments: [{ claimId: "c1", verdict: "supported", summary: "ok", sources: [{ id: "s1", whyItMatters: "w" }] }] } },
      },
    });
    const r = await run(provider);
    expect(r.claims.find((c) => c.text === "C")?.checkworthy).toBe(false);
    expect(r.evidence.map((e) => e.claimId)).toEqual(["c1", "c2", "c4"]);
    expect(r.evidence[1]?.verdict).toBe("insufficient_evidence");
    expect(r.evidence[2]?.verdict).toBe("insufficient_evidence");
    expect(provider.searchCalls[0]?.user).toContain("example.org"); // trusted domains mentioned as preferred
  });

  it("skips research when there are no check-worthy claims", async () => {
    const provider = new FakeProvider({
      structured: { extractClaims: { ok: true, value: { claims: [{ text: "I love cheese", type: "opinion", checkworthy: false, reason: "" }] } } },
    });
    const r = await run(provider);
    expect(provider.searchCalls).toHaveLength(0);
    expect(r.evidence).toEqual([]);
    expect(r.meta.stages.find((s) => s.name === "retrieveEvidence")).toMatchObject({ ok: true, note: "skipped: no check-worthy claims" });
    expect(provider.callsFor("assessEvidence")).toHaveLength(0);
  });
});

describe("analyzePost — degradation", () => {
  it("stage 1 fails → claims [], documented warning, evidence empty, rest of the analysis intact", async () => {
    const provider = new FakeProvider({ structured: { extractClaims: fail("invalid_output") } });
    const r = await run(provider);
    expect(r.claims).toEqual([]);
    expect(r.evidence).toEqual([]);
    expect(r.meta.warnings).toContain(WARNINGS.claimExtractionFailed);
    expect(r.meta.stages[0]).toMatchObject({ name: "extractClaims", ok: false });
    expect(r.classification.headline).toBe("Likely misleading");
    expect(r.engagement.recommendation).toBe("do_not_engage");
    expect(r.communityNote.recommendation).toBe("recommended");
  });

  it("stage 2 fails once → retried and succeeds with a note", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: [fail("timeout"), { ok: true, value: { ...(await import("../../test/fakeProvider.js")).DEFAULT_OUTPUTS.classifyContent as object } }] } });
    const r = await run(provider);
    expect(provider.callsFor("classifyContent")).toHaveLength(2);
    const stage = r.meta.stages.find((s) => s.name === "classifyContent");
    expect(stage?.ok).toBe(true);
    expect(stage?.note).toContain("succeeded on retry");
  });

  it("stage 2 fails twice → AnalysisFailedError (HTTP 502 analysis_failed)", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: fail("api_error", "500 upstream") } });
    await expect(run(provider)).rejects.toBeInstanceOf(AnalysisFailedError);
    await expect(run(provider)).rejects.toMatchObject({ code: "analysis_failed", reason: "api_error" });
    expect(provider.callsFor("classifyContent")).toHaveLength(4); // 2 attempts × 2 runs
  });

  it("web search disabled → insufficient_evidence with an explicit 'unavailable' summary and a warning; stage 4 not called", async () => {
    const provider = new FakeProvider({ webSearch: false });
    const r = await run(provider);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toMatchObject({ claimId: "c1", verdict: "insufficient_evidence", summary: EVIDENCE_UNAVAILABLE_SUMMARY, sources: [] });
    expect(r.meta.warnings).toContain(WARNINGS.retrievalUnavailable);
    expect(r.meta.stages.find((s) => s.name === "retrieveEvidence")).toMatchObject({ ok: false, note: "web search disabled" });
    expect(provider.callsFor("assessEvidence")).toHaveLength(0);
    expect(provider.searchCalls).toHaveLength(0);
  });

  it("search call fails (API error) → same degradation, classification kept", async () => {
    const provider = new FakeProvider({ search: fail("api_error", "tool exploded") });
    const r = await run(provider);
    expect(r.evidence[0]).toMatchObject({ verdict: "insufficient_evidence", summary: EVIDENCE_UNAVAILABLE_SUMMARY });
    expect(r.meta.warnings).toContain(WARNINGS.retrievalUnavailable);
    expect(r.classification.disinformationScore).toBe(80);
  });

  it("search returns no candidates → says so explicitly in the summary and in the warnings", async () => {
    const provider = new FakeProvider({ search: { ok: true, value: { ...DEFAULT_SEARCH, candidates: [], toolErrors: ["max_uses_exceeded"] } } });
    const r = await run(provider);
    expect(r.evidence[0]).toMatchObject({ verdict: "insufficient_evidence", summary: EVIDENCE_NONE_RETRIEVED_SUMMARY, sources: [] });
    expect(r.meta.warnings).toContain(WARNINGS.noSourcesRetrieved);
    expect(r.meta.stages.find((s) => s.name === "retrieveEvidence")?.note).toContain("tool errors: max_uses_exceeded");
    expect(provider.callsFor("assessEvidence")).toHaveLength(0);
  });

  it("stage 4 fails → insufficient_evidence, warning, classification never dropped", async () => {
    const provider = new FakeProvider({ structured: { assessEvidence: fail("invalid_output") } });
    const r = await run(provider);
    expect(r.evidence[0]).toMatchObject({ verdict: "insufficient_evidence", summary: EVIDENCE_ASSESSMENT_FAILED_SUMMARY, sources: [] });
    expect(r.meta.warnings).toContain(WARNINGS.assessmentFailed);
    expect(r.classification.labels).toContain("misinformation");
    expect(r.meta.stages.find((s) => s.name === "assessEvidence")?.ok).toBe(false);
  });

  it("stage 5a fails → engagement uncertain with the documented rationale; 5b unaffected", async () => {
    const provider = new FakeProvider({ structured: { recommendEngagement: fail("rate_limited") } });
    const r = await run(provider);
    expect(r.engagement.recommendation).toBe("uncertain");
    expect(r.engagement.rationale).toBe("The recommendation stage did not complete: the API rate limit was reached.");
    expect(r.meta.warnings).toContain(WARNINGS.engagementFailed("the API rate limit was reached"));
    expect(r.communityNote.recommendation).toBe("recommended");
    expect(r.communityNote.rationale).toContain("NOTE-RATIONALE");
  });

  it("stage 5b fails → note uncertain with the documented rationale; 5a unaffected", async () => {
    const provider = new FakeProvider({ structured: { recommendCommunityNote: fail("timeout") } });
    const r = await run(provider);
    expect(r.communityNote.recommendation).toBe("uncertain");
    expect(r.communityNote.rationale).toBe("The recommendation stage did not complete: the request timed out.");
    expect(r.meta.warnings).toContain(WARNINGS.noteFailed("the request timed out"));
    expect(r.engagement.recommendation).toBe("do_not_engage");
  });

  it("refusal anywhere → stage failure with the refusal warning", async () => {
    const provider = new FakeProvider({ structured: { extractClaims: fail("refusal", "declined"), recommendEngagement: fail("refusal", "declined") } });
    const r = await run(provider);
    expect(r.meta.warnings).toContain(WARNINGS.refusal);
    expect(r.meta.warnings.filter((w) => w === WARNINGS.refusal)).toHaveLength(1);
    expect(r.claims).toEqual([]);
    expect(r.engagement.rationale).toContain("the model declined to analyze this content");
  });

  it("a provider that throws is treated as an API error, not a crash", async () => {
    const provider = new FakeProvider();
    provider.search = async () => {
      throw new Error("network down");
    };
    const r = await run(provider);
    expect(r.meta.stages.find((s) => s.name === "retrieveEvidence")).toMatchObject({ ok: false, note: "api_error: network down" });
    expect(r.meta.warnings).toContain(WARNINGS.retrievalUnavailable);
  });
});

describe("analyzePost — IHRA review and progressive delivery", () => {
  const flagged = {
    ok: true as const,
    value: {
      ...(DEFAULT_OUTPUTS.classifyContent as Record<string, unknown>),
      antisemitism: { assessment: "possible", patterns: ["conspiracy_or_control"], explanation: "control trope", needsIhraReview: true },
    },
  };

  it("runs the IHRA research and assessment when the screening flags the post, and reconciles the classification", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: flagged } });
    const r = await run(provider);
    expect(provider.searchCalls.map((c) => c.stage).sort()).toEqual(["researchIhra", "researchIhra", "retrieveEvidence"]);
    expect(provider.searchCalls.filter((c) => c.stage === "researchIhra").map((c) => c.user.includes("HISTORICAL") ? "historical" : "contemporary").sort()).toEqual(["contemporary", "historical"]);
    expect(provider.callsFor("assessIhra")).toHaveLength(1);
    expect(r.meta.stages.map((s) => s.name)).toEqual([
      "extractClaims",
      "classifyContent",
      "retrieveEvidence",
      "verifySources",
      "assessEvidence",
      "researchIhra",
      "verifyIhraSources",
      "assessIhra",
      "recommendEngagement",
      "recommendCommunityNote",
    ]);
    expect(r.ihra?.assessment).toBe("likely");
    expect(r.ihra?.findings.map((f) => f.pattern)).toEqual(["conspiracy_or_control"]);
    // The full review replaces the screening result and its label follows.
    expect(r.classification.antisemitism.assessment).toBe("likely");
    expect(r.classification.antisemitism.patterns).toEqual(["conspiracy_or_control"]);
    expect(r.classification.antisemitism.categories).toEqual(["conspiracy_or_control"]);
    expect(r.classification.labels[0]).toBe("potentially_antisemitic");
    // Sources: evidence "s1" and IHRA "h1" resolve; "zz9" is dropped and reported.
    expect(r.ihra?.sources.map((s) => s.id).sort()).toEqual(["h1", "s1"]);
    expect(r.ihra?.communityNote2?.sources.map((s) => s.id).sort()).toEqual(["h1", "s1"]);
    expect(r.meta.warnings).toContain(WARNINGS.droppedSourceIds);
    // The recommendations see the review.
    expect(provider.callsFor("recommendEngagement")[0]?.user).toContain("IHRA review: likely");
    expect(provider.callsFor("recommendCommunityNote")[0]?.user).toContain("IHRA-SUMMARY");
  });

  it("emits progress snapshots in order: classification, evidence, IHRA review", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: flagged } });
    const phases: string[] = [];
    const seen: Array<{ classification: boolean; evidence: boolean; ihra: boolean; pending: boolean }> = [];
    await analyzePost(TEST_POST, undefined, {
      provider,
      validateUrl: fakeValidateUrl,
      onProgress: (p) => {
        phases.push(p.phase);
        seen.push({ classification: Boolean(p.classification), evidence: Boolean(p.evidence), ihra: Boolean(p.ihra), pending: p.ihraPending });
      },
    });
    expect(phases).toEqual(["checking_evidence", "reviewing_ihra", "recommending"]);
    expect(seen[0]).toMatchObject({ classification: true, evidence: false, ihra: false, pending: true });
    expect(seen[1]).toMatchObject({ classification: true, evidence: true, ihra: false, pending: true });
    expect(seen[2]).toMatchObject({ classification: true, evidence: true, ihra: true, pending: false });
  });

  it("runs the point-by-point comparison in parallel when a Nazi / Holocaust analogy is suspected, and normalizes its rows", async () => {
    const analogyFlagged = { ok: true as const, value: { ...flagged.value, antisemitism: { ...flagged.value.antisemitism, patterns: ["nazi_analogy"] } } };
    const provider = new FakeProvider({
      structured: {
        classifyContent: analogyFlagged,
        assessIhra: {
          ok: true,
          value: {
            ...(DEFAULT_OUTPUTS.assessIhra as Record<string, unknown>),
            findings: [],
            analogy: { present: true, historicalReferent: "Auschwitz", contemporaryReferent: "Gaza", mechanisms: ["Nazi Comparison", "bogus"], mechanismExplanation: "…", suppressesMaterialDifferences: true, conclusion: "…" },
          },
        },
      },
    });
    const r = await run(provider);
    expect(provider.callsFor("compareAnalogy")).toHaveLength(1);
    expect(r.meta.stages.find((s) => s.name === "compareAnalogy")).toMatchObject({ ok: true, note: expect.stringContaining("2 dimensions") });
    expect(r.ihra?.analogy?.mechanisms).toEqual(["nazi_comparison"]);
    // The unknown dimension is dropped; the basis is normalized; source ids resolve against the research sources.
    expect(r.ihra?.analogy?.rows).toHaveLength(1);
    expect(r.ihra?.analogy?.rows[0]).toMatchObject({ dimension: "casualty_magnitude", historicalBasis: "sourced", contemporaryBasis: "unknown", sourceIds: ["h1"] });
    // A post with no such vocabulary and no such pattern skips the comparison.
    const plain = new FakeProvider({ structured: { classifyContent: flagged } });
    await run(plain);
    expect(plain.callsFor("compareAnalogy")).toHaveLength(0);
  });

  it("degrades to the screening result when the IHRA assessment fails", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: flagged, assessIhra: fail("api_error", "boom") } });
    const r = await run(provider);
    expect(r.ihra).toBeUndefined();
    expect(r.classification.antisemitism.assessment).toBe("possible");
    expect(r.meta.warnings.join(" ")).toContain("full IHRA review did not complete");
    expect(r.meta.stages.find((s) => s.name === "assessIhra")).toMatchObject({ ok: false });
  });

  it("keeps the IHRA review without sources when web search is unavailable", async () => {
    const provider = new FakeProvider({ structured: { classifyContent: flagged }, webSearch: false });
    const r = await run(provider);
    expect(r.meta.stages.find((s) => s.name === "researchIhra")).toMatchObject({ ok: false, note: "web search disabled" });
    expect(r.meta.warnings).toContain(WARNINGS.ihraResearchUnavailable);
    expect(r.ihra?.assessment).toBe("likely");
    expect(r.ihra?.sources).toEqual([]); // s1/h1 do not exist without searches; zz9 dropped
  });
});
