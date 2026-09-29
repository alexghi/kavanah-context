import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { extractCandidateSources, normalizeUrl, publisherFromUrl } from "./candidates.js";

type Block = Anthropic.Messages.ContentBlock;

const toolUse = (id: string, query: string): Block => ({ type: "server_tool_use", id, name: "web_search", input: { query }, caller: { type: "direct" } }) as unknown as Block;
const results = (id: string, items: Array<{ url: string; title?: string; page_age?: string | null }>): Block =>
  ({ type: "web_search_tool_result", tool_use_id: id, caller: { type: "direct" }, content: items.map((i) => ({ type: "web_search_result", url: i.url, title: i.title ?? "", page_age: i.page_age ?? null, encrypted_content: "enc" })) }) as unknown as Block;
const errorResult = (id: string, error_code: string): Block => ({ type: "web_search_tool_result", tool_use_id: id, caller: { type: "direct" }, content: { type: "web_search_tool_result_error", error_code } }) as unknown as Block;
const text = (t: string, citations: Array<{ url: string; title?: string | null; cited_text: string }> | null = null): Block =>
  ({ type: "text", text: t, citations: citations?.map((c) => ({ type: "web_search_result_location", url: c.url, title: c.title ?? null, cited_text: c.cited_text, encrypted_index: "i" })) ?? null }) as unknown as Block;

describe("extractCandidateSources", () => {
  it("collects results and citations, dedupes by URL, merges snippets and assigns ids", () => {
    const content: Block[] = [
      toolUse("t1", "who owns the fed"),
      results("t1", [
        { url: "https://www.federalreserve.gov/faqs/about_14986.htm", title: "Who owns the Federal Reserve?", page_age: "2 years ago" },
        { url: "https://en.wikipedia.org/wiki/Federal_Reserve#History", title: "Federal Reserve" },
      ]),
      toolUse("t2", "rothschild myth"),
      results("t2", [{ url: "https://en.wikipedia.org/wiki/Federal_Reserve", title: "Federal Reserve - Wikipedia" }]),
      text("The Fed is not privately owned.", [
        { url: "https://www.federalreserve.gov/faqs/about_14986.htm", title: "Who owns the Federal Reserve?", cited_text: "The Federal Reserve System is not 'owned' by anyone." },
        { url: "https://www.ajc.org/translatehate/rothschild", title: "Rothschild", cited_text: "A conspiracy myth." },
      ]),
      { type: "thinking", thinking: "…", signature: "" } as unknown as Block,
    ];
    const out = extractCandidateSources(content);
    expect(out.searches).toBe(2);
    expect(out.queries).toEqual(["who owns the fed", "rothschild myth"]);
    expect(out.notes).toBe("The Fed is not privately owned.");
    expect(out.toolErrors).toEqual([]);
    expect(out.candidates.map((c) => c.id)).toEqual(["s1", "s2", "s3"]);
    expect(out.candidates[0]).toEqual({
      id: "s1",
      url: "https://www.federalreserve.gov/faqs/about_14986.htm",
      title: "Who owns the Federal Reserve?",
      publisher: "federalreserve.gov",
      pageAge: "2 years ago",
      snippet: "The Federal Reserve System is not 'owned' by anyone.",
    });
    expect(out.candidates[1]).toMatchObject({ url: "https://en.wikipedia.org/wiki/Federal_Reserve#History", publisher: "en.wikipedia.org", title: "Federal Reserve" });
    expect(out.candidates[2]).toMatchObject({ url: "https://www.ajc.org/translatehate/rothschild", publisher: "ajc.org", snippet: "A conspiracy myth." });
  });

  it("handles the error-object content shape without crashing and records the error code", () => {
    const out = extractCandidateSources([toolUse("t1", "q"), errorResult("t1", "max_uses_exceeded"), text("Sorry, no results.")]);
    expect(out.candidates).toEqual([]);
    expect(out.toolErrors).toEqual(["max_uses_exceeded"]);
    expect(out.searches).toBe(1);
  });

  it("caps candidates, skips non-http URLs and untitled results get the publisher as title", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ url: `https://site${i}.org/page`, title: i === 0 ? "" : `Page ${i}` }));
    const out = extractCandidateSources([results("t", [...many, { url: "ftp://files.example.org/x", title: "ftp" }, { url: "not a url", title: "bad" }])], { max: 12 });
    expect(out.candidates).toHaveLength(12);
    expect(out.candidates[0]?.title).toBe("site0.org");
    expect(out.candidates.every((c) => c.url.startsWith("https://"))).toBe(true);
  });

  it("citations for URLs beyond the cap still merge snippets into existing candidates", () => {
    const out = extractCandidateSources(
      [results("t", [{ url: "https://a.org/", title: "A" }, { url: "https://b.org", title: "B" }]), text("x", [{ url: "https://a.org", cited_text: "quote A" }, { url: "https://c.org", cited_text: "quote C" }])],
      { max: 2 },
    );
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates[0]?.snippet).toBe("quote A");
  });
});

describe("url helpers", () => {
  it("publisher strips www and lowercases; normalizeUrl drops fragments and trailing slashes", () => {
    expect(publisherFromUrl("https://WWW.Example.org/a/b")).toBe("example.org");
    expect(publisherFromUrl("nope")).toBe("");
    expect(normalizeUrl("https://a.org/path/#frag")).toBe("https://a.org/path");
    expect(normalizeUrl("https://a.org/")).toBe("https://a.org/");
    expect(normalizeUrl("https://A.org/x?q=1")).toBe("https://a.org/x?q=1");
  });
});
