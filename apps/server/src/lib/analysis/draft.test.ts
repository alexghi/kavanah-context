import { DraftResponseSchema, type AnalyzePostResponse, type DraftRequest, type Source } from "@kavannah/shared";
import { describe, expect, it } from "vitest";
import { FakeProvider, TEST_POST } from "../../test/fakeProvider.js";
import { DRAFT_WARNINGS, DraftFailedError, NO_SOURCE_WARNING, collectAnalysisSources, draftLanguage, ensureNoteSource, generateDraft, sanitizeDraft } from "./draft.js";

const s1: Source = { id: "s1", title: "Moon", url: "https://example.org/moon", publisher: "example.org", retrievedVia: "web_search", verified: true };
const s2: Source = { id: "s2", title: "Other", url: "https://example.org/other", publisher: "example.org", retrievedVia: "web_search", verified: false };
const s3: Source = { id: "s3", title: "Third", url: "https://example.org/third", publisher: "example.org", retrievedVia: "web_search", verified: true };

function analysisWith(sources: Source[]): AnalyzePostResponse {
  return {
    post: TEST_POST,
    classification: { headline: "Likely misleading", labels: ["factual_claim", "misinformation"], explanation: "e", confidence: "high", disinformationScore: 80, antisemitism: { assessment: "not_detected", categories: [], explanation: "n" } },
    claims: [{ id: "c1", text: "The Moon is made of cheese.", type: "factual", checkworthy: true }],
    evidence: [{ claimId: "c1", claim: "The Moon is made of cheese.", verdict: sources.length ? "contradicted" : "insufficient_evidence", summary: "s", sources }],
    engagement: { recommendation: "engage", rationale: "r" },
    communityNote: { recommendation: "recommended", rationale: "r" },
    meta: { version: 1, mode: "live", model: "fake", analyzedAt: new Date().toISOString(), durationMs: 1, stages: [], warnings: [] },
  };
}

describe("sanitizeDraft", () => {
  it("keeps allowed URLs, removes foreign ones and caps the count per kind", () => {
    const r = sanitizeDraft("See https://example.org/moon and https://evil.example/fake. Also https://example.org/third.", "community_note", [s1, s2, s3]);
    expect(r.text).toBe("See https://example.org/moon and . Also https://example.org/third.");
    expect(r.sources.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(r.warnings).toEqual([DRAFT_WARNINGS.removedForeignUrl]);

    const capped = sanitizeDraft("A https://example.org/moon B https://example.org/third", "reply", [s1, s3]);
    expect(capped.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(capped.text).toBe("A https://example.org/moon B");
    expect(capped.warnings).toEqual([DRAFT_WARNINGS.removedExtraUrl(1)]);
  });

  it("strips @mentions from replies, warns on long replies and unverified sources", () => {
    const r = sanitizeDraft("@someone this is wrong, see https://example.org/other", "reply", [s2]);
    expect(r.text).toBe("this is wrong, see https://example.org/other");
    expect(r.warnings).toEqual(expect.arrayContaining([DRAFT_WARNINGS.removedMention, DRAFT_WARNINGS.unverifiedSource]));
    expect(sanitizeDraft("Hello. mail me at me@example.org", "reply", []).text).toBe("Hello. mail me at me@example.org"); // not a mention

    const long = sanitizeDraft("x".repeat(300), "reply", []);
    expect(long.warnings).toEqual([DRAFT_WARNINGS.replyTooLong]);
    expect(sanitizeDraft("@someone " + "x".repeat(300), "community_note", []).warnings).toEqual([]); // notes are not replies
  });

  it("matches URLs loosely (trailing slash / punctuation) and de-duplicates", () => {
    const r = sanitizeDraft("Source: https://example.org/moon/. Again https://example.org/moon.", "community_note", [s1]);
    expect(r.sources).toHaveLength(1);
    expect(r.text).toBe("Source: https://example.org/moon. Again https://example.org/moon.");
  });
});

describe("ensureNoteSource / helpers", () => {
  it("appends the best verified source to a note without one", () => {
    expect(ensureNoteSource("Note text.", [], [s2, s3])).toEqual({ text: "Note text. https://example.org/third", sources: [s3], added: true });
    expect(ensureNoteSource("Note text.", [s1], [s1])).toMatchObject({ added: false });
    expect(ensureNoteSource("Note text.", [], [])).toMatchObject({ added: false, sources: [] });
  });

  it("collects analysis sources verified-first and picks the draft language", () => {
    expect(collectAnalysisSources(analysisWith([s2, s1])).map((s) => s.id)).toEqual(["s1", "s2"]);
    const base: DraftRequest = { post: { ...TEST_POST, language: "fr" }, analysis: analysisWith([]), kind: "reply" };
    expect(draftLanguage(base)).toBe("fr");
    expect(draftLanguage({ ...base, options: { preferences: { language: "de" } } })).toBe("de");
    expect(draftLanguage({ ...base, post: { ...TEST_POST, language: undefined } })).toBe("the language of the post");
  });
});

describe("generateDraft", () => {
  it("returns a sanitized, valid DraftResponse and lists only sources from the analysis", async () => {
    const provider = new FakeProvider({ structured: { "draft:reply": { ok: true, value: { text: "@author wrong. https://example.org/moon https://made.up/x", sourceIds: ["s1", "x"] } } } });
    const draft = await generateDraft({ post: TEST_POST, analysis: analysisWith([s1]), kind: "reply", options: { preferences: { language: "en" } } }, { provider });
    expect(() => DraftResponseSchema.parse(draft)).not.toThrow();
    expect(draft.text).toBe("wrong. https://example.org/moon");
    expect(draft.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(draft.warnings).toEqual(expect.arrayContaining([DRAFT_WARNINGS.removedForeignUrl, DRAFT_WARNINGS.removedMention]));
    expect(draft.meta).toMatchObject({ mode: "live", model: "fake-model" });
    expect(provider.calls[0]?.user).toContain("in this language: en");
    expect(provider.calls[0]?.user).toContain("https://example.org/moon");
  });

  it("a note without any available source is produced without URL plus the documented warning", async () => {
    const provider = new FakeProvider({ structured: { "draft:community_note": { ok: true, value: { text: "No public record confirms this. https://example.org/moon", sourceIds: [] } } } });
    const draft = await generateDraft({ post: TEST_POST, analysis: analysisWith([]), kind: "community_note" }, { provider });
    expect(draft.text).toBe("No public record confirms this.");
    expect(draft.sources).toEqual([]);
    expect(draft.warnings).toEqual([DRAFT_WARNINGS.removedForeignUrl, NO_SOURCE_WARNING]);
  });

  it("a note that forgot its source gets the best verified one appended", async () => {
    const provider = new FakeProvider({ structured: { "draft:community_note": { ok: true, value: { text: "The Moon is rock.", sourceIds: [] } } } });
    const draft = await generateDraft({ post: TEST_POST, analysis: analysisWith([s2, s1]), kind: "community_note" }, { provider });
    expect(draft.text).toBe("The Moon is rock. https://example.org/moon");
    expect(draft.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(draft.warnings).toEqual([]);
  });

  it("provider failure → DraftFailedError", async () => {
    const provider = new FakeProvider({ structured: { "draft:reply": { ok: false, reason: "refusal", message: "no" } } });
    await expect(generateDraft({ post: TEST_POST, analysis: analysisWith([s1]), kind: "reply" }, { provider })).rejects.toBeInstanceOf(DraftFailedError);
  });
});
