import { AnalyzePostResponseSchema, FixtureSchema, type Fixture } from "@kavannah/shared";
import { describe, expect, it } from "vitest";
import { validateUrl } from "../lib/sources/validateUrl.js";
import { FIXTURES, findFixture } from "./fixtures.js";

const EXPECTED_IDS = [
  "misleading-claim",
  "antisemitic-claim",
  "antisemitic-no-claim",
  "political-opinion",
  "benign-factual",
  "insufficient-evidence",
  "no-engage-note-recommended",
  "both-not-recommended",
  "mention-not-use",
  "misleading-framing",
];

function get(id: string): Fixture {
  const f = findFixture(id);
  if (!f) throw new Error(`missing fixture ${id}`);
  return f;
}

function uniqueSources(f: Fixture) {
  return [...new Map(f.analysis.evidence.flatMap((e) => e.sources).map((s) => [s.url, s])).values()];
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

describe("fixtures — structure", () => {
  it("has exactly the 10 scenarios, in the brief's order, all valid", () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(EXPECTED_IDS);
    for (const f of FIXTURES) {
      expect(() => FixtureSchema.parse(f)).not.toThrow();
      expect(() => AnalyzePostResponseSchema.parse(f.analysis)).not.toThrow();
      expect(f.analysis.meta.mode).toBe("mock");
      expect(f.analysis.meta.fixtureId).toBe(f.id);
      expect(f.analysis.meta.version).toBe(1);
      expect(f.analysis.post).toEqual(f.post);
      expect(f.post.url).toMatch(/^https:\/\/x\.com\/[a-z0-9_]+\/status\/\d+$/);
      expect(f.post.author?.handle).toMatch(/^@[a-z0-9_]+$/);
    }
  });

  it("evidence refers to existing claims, sources are fixtures and verified, and drafts only cite analysis sources", () => {
    for (const f of FIXTURES) {
      const claimIds = new Set(f.analysis.claims.map((c) => c.id));
      for (const e of f.analysis.evidence) {
        expect(claimIds.has(e.claimId)).toBe(true);
        for (const s of e.sources) {
          expect(s.retrievedVia).toBe("fixture");
          expect(s.verified).toBe(true);
          expect(s.publisher).not.toMatch(/^www\./);
        }
      }
      const allowed = new Set(uniqueSources(f).map((s) => s.url));
      for (const kind of ["reply", "community_note"] as const) {
        const draft = f.drafts[kind];
        if (!draft) continue;
        const urls = draft.match(URL_RE) ?? [];
        for (const url of urls) expect(allowed.has(url), `${f.id} ${kind} cites unknown ${url}`).toBe(true);
        expect(urls.length).toBeLessThanOrEqual(kind === "reply" ? 1 : 2);
        expect(draft).not.toMatch(/(^|\s)@\w+/);
      }
      if (f.drafts.reply) expect(f.drafts.reply.length, `${f.id} reply length`).toBeLessThanOrEqual(280);
      if (f.drafts.community_note && f.analysis.communityNote.recommendation === "recommended") {
        expect(f.drafts.community_note.match(URL_RE)?.length ?? 0, `${f.id} note should cite a source`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("fixtures — scenario expectations", () => {
  it("1 misleading-claim: high score, not antisemitic, note recommended, engage", () => {
    const a = get("misleading-claim").analysis;
    expect(a.classification.disinformationScore).toBeGreaterThanOrEqual(75);
    expect(a.classification.labels).toContain("misinformation");
    expect(a.classification.labels).not.toContain("potentially_antisemitic");
    expect(a.classification.antisemitism.assessment).toBe("not_detected");
    expect(a.communityNote.recommendation).toBe("recommended");
    expect(a.engagement.recommendation).toBe("engage");
    expect(a.evidence.some((e) => e.verdict === "contradicted")).toBe(true);
  });

  it("2 antisemitic-claim: potentially_antisemitic + misinformation, note recommended, engage uncertain", () => {
    const a = get("antisemitic-claim").analysis;
    expect(a.classification.labels).toEqual(expect.arrayContaining(["potentially_antisemitic", "misinformation"]));
    expect(["possible", "likely"]).toContain(a.classification.antisemitism.assessment);
    expect(a.classification.antisemitism.categories).toContain("conspiracy_or_control");
    expect(a.communityNote.recommendation).toBe("recommended");
    expect(a.engagement.recommendation).toBe("uncertain");
    expect(a.claims.some((c) => c.checkworthy)).toBe(true);
  });

  it("3 antisemitic-no-claim: potentially_antisemitic, LOW score, no claims, note not recommended, do not engage", () => {
    const a = get("antisemitic-no-claim").analysis;
    expect(a.classification.labels).toContain("potentially_antisemitic");
    expect(a.classification.labels).not.toContain("misinformation");
    expect(a.classification.disinformationScore).toBeLessThan(25);
    expect(a.claims).toEqual([]);
    expect(a.evidence).toEqual([]);
    expect(a.communityNote.recommendation).toBe("not_recommended");
    expect(a.engagement.recommendation).toBe("do_not_engage");
  });

  it("4 political-opinion: opinion, not antisemitic, both not recommended, low score", () => {
    const a = get("political-opinion").analysis;
    expect(a.classification.labels).toContain("opinion");
    expect(a.classification.labels).not.toContain("potentially_antisemitic");
    expect(a.classification.antisemitism.assessment).toBe("not_detected");
    expect(a.classification.disinformationScore).toBeLessThan(25);
    expect(a.communityNote.recommendation).toBe("not_recommended");
    expect(a.engagement.recommendation).toBe("do_not_engage");
  });

  it("5 benign-factual: benign + factual_claim, supported, both not recommended, score near 0", () => {
    const a = get("benign-factual").analysis;
    expect(a.classification.labels).toEqual(expect.arrayContaining(["benign", "factual_claim"]));
    expect(a.classification.disinformationScore).toBeLessThanOrEqual(5);
    expect(a.evidence.length).toBeGreaterThan(0);
    expect(a.evidence.every((e) => e.verdict === "supported")).toBe(true);
    expect(a.communityNote.recommendation).toBe("not_recommended");
    expect(a.engagement.recommendation).toBe("do_not_engage");
  });

  it("6 insufficient-evidence: unverifiable_claim, insufficient_evidence, both uncertain", () => {
    const a = get("insufficient-evidence").analysis;
    expect(a.classification.labels).toContain("unverifiable_claim");
    expect(a.evidence.map((e) => e.verdict)).toEqual(["insufficient_evidence"]);
    expect(a.evidence[0]?.sources).toEqual([]);
    expect(a.communityNote.recommendation).toBe("uncertain");
    expect(a.engagement.recommendation).toBe("uncertain");
    expect(a.meta.warnings.length).toBeGreaterThan(0);
  });

  it("7 no-engage-note-recommended (key demo): do_not_engage + recommended, 2 verified sources, excellent note", () => {
    const f = get("no-engage-note-recommended");
    const a = f.analysis;
    expect(a.engagement.recommendation).toBe("do_not_engage");
    expect(a.communityNote.recommendation).toBe("recommended");
    expect(a.classification.labels).toEqual(expect.arrayContaining(["potentially_antisemitic", "misinformation"]));
    expect(a.classification.antisemitism.assessment).toBe("likely");
    expect(a.classification.disinformationScore).toBeGreaterThanOrEqual(75);
    const sources = uniqueSources(f);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.verified)).toBe(true);
    expect(a.evidence.every((e) => e.verdict === "contradicted")).toBe(true);
    expect(a.engagement.rationale.length).toBeGreaterThan(80);
    expect(a.communityNote.rationale.length).toBeGreaterThan(80);
    const note = f.drafts.community_note!;
    expect(note.match(URL_RE)).toHaveLength(2);
    expect(note).toContain("https://www.federalreserve.gov/faqs/about_14986.htm");
    expect(note.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 20).length).toBeLessThanOrEqual(4);
    expect(f.drafts.reply!.length).toBeLessThanOrEqual(280);
  });

  it("8 both-not-recommended: labelled satire, both not recommended", () => {
    const a = get("both-not-recommended").analysis;
    expect(a.classification.labels).toContain("benign");
    expect(a.communityNote.recommendation).toBe("not_recommended");
    expect(a.engagement.recommendation).toBe("do_not_engage");
    expect(a.claims).toEqual([]);
  });

  it("9 mention-not-use: not antisemitic (mention), benign, both not recommended", () => {
    const a = get("mention-not-use").analysis;
    expect(a.classification.antisemitism.assessment).toBe("not_detected");
    expect(a.classification.labels).toContain("benign");
    expect(a.classification.labels).not.toContain("potentially_antisemitic");
    expect(a.communityNote.recommendation).toBe("not_recommended");
    expect(a.engagement.recommendation).toBe("do_not_engage");
    expect(a.evidence.every((e) => e.verdict === "supported")).toBe(true);
  });

  it("10 misleading-framing: misleading_framing, partially_supported, note recommended, engage", () => {
    const a = get("misleading-framing").analysis;
    expect(a.classification.labels).toContain("misleading_framing");
    expect(a.evidence.map((e) => e.verdict)).toContain("partially_supported");
    expect(a.communityNote.recommendation).toBe("recommended");
    expect(a.engagement.recommendation).toBe("engage");
    expect(a.classification.disinformationScore).toBeGreaterThanOrEqual(50);
    expect(a.classification.disinformationScore).toBeLessThan(75);
  });
});

// Opt-in network check of every fixture source URL: KAVANNAH_TEST_NETWORK=1 npm test
describe.skipIf(!process.env.KAVANNAH_TEST_NETWORK)("fixtures — source URLs resolve (network)", () => {
  const urls = [...new Set(FIXTURES.flatMap((f) => f.analysis.evidence.flatMap((e) => e.sources.map((s) => s.url))))];
  it.each(urls)("%s", async (url) => {
    const check = await validateUrl(url, { timeoutMs: 15_000 });
    expect(check.ok, JSON.stringify(check)).toBe(true);
  }, 20_000);
});
