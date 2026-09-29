import { AnalyzePostResponseSchema, DraftResponseSchema, type PostContext } from "@kavannah/shared";
import { describe, expect, it } from "vitest";
import { NO_SOURCE_WARNING } from "../lib/analysis/draft.js";
import { FIXTURES, findFixture } from "./fixtures.js";
import { GENERIC_DRAFT_WARNING, GENERIC_FIXTURE_ID, GENERIC_WARNING, MOCK_WARNING, containment, jaccard, matchFixture, mockAnalyze, mockDraft, tokenize } from "./mockProvider.js";

const key = findFixture("no-engage-note-recommended")!;
const NO_DELAY = { delayMs: [0, 0] as [number, number] };

describe("matchFixture", () => {
  it("matches by post id, then by URL, then by text similarity, else null", () => {
    expect(matchFixture({ platform: "x", url: "https://x.com/whoever/status/999", id: key.post.id, text: "totally different" })?.via).toBe("id");
    expect(matchFixture({ platform: "x", url: key.post.url.replace("https://x.com", "https://twitter.com") + "?s=20", text: "other text" })?.via).toBe("url");

    const fuzzy: PostContext = { platform: "x", url: "https://x.com/other/status/1", text: "The Rothschild family owns the Federal Reserve and every central bank on earth. That's why your rent doubled. Wake up." };
    const m = matchFixture(fuzzy);
    expect(m?.via).toBe("text");
    expect(m?.fixture.id).toBe("no-engage-note-recommended");

    expect(matchFixture({ platform: "x", url: "https://x.com/other/status/2", text: "Lovely weather in Lisbon today, going for a swim." })).toBeNull();
  });

  it("every fixture matches itself by text alone and fixtures do not collide", () => {
    for (const f of FIXTURES) {
      const m = matchFixture({ platform: "x", url: "https://x.com/someone/status/1", text: f.post.text });
      expect(m?.fixture.id).toBe(f.id);
    }
  });

  it("similarity helpers", () => {
    const a = tokenize("The Moon is made of cheese! https://example.org/x");
    const b = tokenize("the moon is made of rock");
    expect([...a]).not.toContain("https");
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, b)).toBeCloseTo(5 / 7);
    expect(containment(tokenize("moon cheese"), tokenize("the moon is made of cheese"))).toBe(1);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("mockAnalyze", () => {
  it("returns the fixture's analysis with mode mock, fixtureId, fresh timestamp and the demo warning first", async () => {
    const before = Date.now();
    const r = await mockAnalyze(key.post, { mock: true }, NO_DELAY);
    expect(() => AnalyzePostResponseSchema.parse(r)).not.toThrow();
    expect(r.meta.mode).toBe("mock");
    expect(r.meta.fixtureId).toBe(key.id);
    expect(r.meta.warnings[0]).toBe(MOCK_WARNING);
    expect(Date.parse(r.meta.analyzedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(r.engagement.recommendation).toBe("do_not_engage");
    expect(r.communityNote.recommendation).toBe("recommended");
    expect(r.post).toEqual(key.post);
  });

  it("echoes the request's post on fuzzy matches and never mutates the fixture", async () => {
    const post: PostContext = { platform: "x", url: "https://x.com/copycat/status/5", text: key.post.text + " (copied)" };
    const r = await mockAnalyze(post, undefined, NO_DELAY);
    expect(r.post).toEqual(post);
    r.meta.warnings.push("mutation");
    expect(key.analysis.meta.warnings).not.toContain("mutation");
  });

  it("falls back to a generic, clearly-labelled demo analysis", async () => {
    const r = await mockAnalyze({ platform: "x", url: "https://x.com/u/status/42", text: "Unrelated post about gardening tips." }, undefined, NO_DELAY);
    expect(() => AnalyzePostResponseSchema.parse(r)).not.toThrow();
    expect(r.meta.fixtureId).toBe(GENERIC_FIXTURE_ID);
    expect(r.engagement.recommendation).toBe("uncertain");
    expect(r.communityNote.recommendation).toBe("uncertain");
    expect(r.classification.explanation).toContain("demo");
    expect(r.meta.warnings).toEqual([MOCK_WARNING, GENERIC_WARNING]);
  });

  it("simulates a delay in the configured range", async () => {
    const started = Date.now();
    const r = await mockAnalyze(key.post, undefined, { delayMs: [40, 60], random: () => 0.5 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(r.meta.durationMs).toBe(50);
  });
});

describe("mockDraft", () => {
  it("returns the fixture's draft with the cited sources", async () => {
    const analysis = await mockAnalyze(key.post, undefined, NO_DELAY);
    const draft = await mockDraft({ post: key.post, analysis, kind: "community_note" }, NO_DELAY);
    expect(() => DraftResponseSchema.parse(draft)).not.toThrow();
    expect(draft.text).toBe(key.drafts.community_note);
    expect(draft.sources.map((s) => s.url)).toEqual(["https://www.federalreserve.gov/faqs/about_14986.htm", "https://www.ajc.org/translatehate/rothschild"]);
    expect(draft.warnings).toEqual([MOCK_WARNING]);
    expect(draft.meta.mode).toBe("mock");

    const reply = await mockDraft({ post: key.post, analysis, kind: "reply" }, NO_DELAY);
    expect(reply.text).toBe(key.drafts.reply);
    expect(reply.sources).toHaveLength(1);
  });

  it("composes a generic draft when the fixture has none, and warns when a note has no source", async () => {
    const satire = findFixture("both-not-recommended")!;
    const analysis = await mockAnalyze(satire.post, undefined, NO_DELAY);
    const note = await mockDraft({ post: satire.post, analysis, kind: "community_note" }, NO_DELAY);
    expect(note.warnings).toEqual([MOCK_WARNING, GENERIC_DRAFT_WARNING, NO_SOURCE_WARNING]);
    expect(note.sources).toEqual([]);

    const unverifiable = findFixture("insufficient-evidence")!;
    const a2 = await mockAnalyze(unverifiable.post, undefined, NO_DELAY);
    const n2 = await mockDraft({ post: unverifiable.post, analysis: a2, kind: "community_note" }, NO_DELAY);
    expect(n2.text).toBe(unverifiable.drafts.community_note);
    expect(n2.text).not.toMatch(/https?:/);
    expect(n2.warnings).toContain(NO_SOURCE_WARNING);
  });
});
