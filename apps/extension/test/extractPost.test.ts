import { beforeEach, describe, expect, it } from "vitest";
import { PostContextSchema } from "@kavannah/shared";
import {
  collectText,
  extractPost,
  findMainPostArticle,
  isInsideQuote,
  PostExtractionError,
} from "@/lib/x/extractPost";
import { articles, loadFixture } from "./helpers/dom";

const HOME = "https://x.com/home";

describe("extractPost", () => {
  beforeEach(() => loadFixture());

  it("extracts a normal post (a): text with emoji, author, canonical url, id, language, date", () => {
    const post = extractPost(articles()[0], { locationHref: HOME });
    expect(post.platform).toBe("x");
    expect(post.text).toBe("Breaking: the French government announced 🇫🇷 a new plan. Full report: lemonde.fr/report");
    expect(post.author).toEqual({ displayName: "Le Monde", handle: "@lemonde" });
    expect(post.url).toBe("https://x.com/lemonde/status/1834567890123456789");
    expect(post.id).toBe("1834567890123456789");
    expect(post.language).toBe("en");
    expect(post.postedAt).toBe("2026-09-28T09:15:00.000Z");
    expect(post.context).toEqual({ hasMedia: false }); // t.co links are not "external"
    expect(PostContextSchema.safeParse(post).success).toBe(true);
  });

  it("extracts a post with a quoted post and a photo (b) without mixing in the quote", () => {
    const post = extractPost(articles()[1], { locationHref: HOME });
    expect(post.text).toBe("This claim keeps circulating. Read the actual numbers before sharing.");
    expect(post.author).toEqual({ displayName: "Dana ✍️", handle: "@dana_writes" });
    expect(post.url).toBe("https://x.com/dana_writes/status/1834570000000000001");
    expect(post.postedAt).toBe("2026-09-29T07:42:10.000Z");
    expect(post.context?.quotedPost).toEqual({
      text: "Original quoted post text about the numbers. inside-quote.example.org",
      author: "@quoted_acct",
    });
    expect(post.context?.hasMedia).toBe(true);
    expect(post.context?.links).toEqual(["https://www.reuters.com/world/europe/example-2026"]);
    expect(post.context?.replyingTo).toBeUndefined();
    expect(PostContextSchema.safeParse(post).success).toBe(true);
  });

  it("extracts a reply (c) with the handles it replies to and the post language", () => {
    const post = extractPost(articles()[2], { locationHref: HOME });
    expect(post.text).toBe("Vous avez une source pour ça ?");
    expect(post.language).toBe("fr");
    expect(post.author).toEqual({ displayName: "Sam", handle: "@sam_replies" });
    expect(post.context?.replyingTo).toEqual(["@lemonde", "@dana_writes"]);
    expect(post.context?.hasMedia).toBe(false);
    expect(post.url).toBe("https://x.com/sam_replies/status/1834580000000000002");
  });

  it("throws a typed error when the post has no text", () => {
    const article = articles()[0]!;
    article.querySelector('[data-testid="tweetText"]')?.remove();
    expect(() => extractPost(article, { locationHref: HOME })).toThrowError(PostExtractionError);
    try {
      extractPost(article, { locationHref: HOME });
    } catch (err) {
      expect((err as PostExtractionError).code).toBe("NO_TEXT");
    }
    expect(() => extractPost(null, { locationHref: HOME })).toThrowError(PostExtractionError);
  });

  it("falls back to the page URL on /status/ pages when there is no time link", () => {
    const article = articles()[0]!;
    for (const a of article.querySelectorAll('a[href*="/status/"]')) a.remove();
    const post = extractPost(article, { locationHref: "https://x.com/lemonde/status/1834567890123456789" });
    expect(post.url).toBe("https://x.com/lemonde/status/1834567890123456789");
    expect(post.id).toBe("1834567890123456789");
  });

  it("never throws on missing optional data", () => {
    const article = articles()[2]!;
    article.querySelector('[data-testid="User-Name"]')?.remove();
    article.querySelector("time")?.remove();
    const post = extractPost(article, { locationHref: HOME });
    expect(post.author).toBeUndefined();
    expect(post.postedAt).toBeUndefined();
    expect(post.text).toBe("Vous avez une source pour ça ?");
  });

  it("collectText keeps text nodes and emoji alts in order and skips buttons", () => {
    const el = document.createElement("div");
    el.innerHTML = 'Hello <img alt="👋"> <span>world</span><button>Show more</button><br>next';
    expect(collectText(el)).toBe("Hello 👋 world\nnext");
  });

  it("isInsideQuote detects the quoted container", () => {
    const article = articles()[1]!;
    const texts = article.querySelectorAll('[data-testid="tweetText"]');
    expect(isInsideQuote(texts[0]!, article)).toBe(false);
    expect(isInsideQuote(texts[1]!, article)).toBe(true);
  });
});

describe("findMainPostArticle", () => {
  beforeEach(() => loadFixture());

  it("returns the article whose status link matches the page id", () => {
    const main = findMainPostArticle(document, "https://x.com/dana_writes/status/1834570000000000001");
    expect(main).toBe(articles()[1]);
  });

  it("falls back to the first article on a status page with no matching link", () => {
    const main = findMainPostArticle(document, "https://x.com/someone/status/999");
    expect(main).toBe(articles()[0]);
  });

  it("returns null when the page is not a post page", () => {
    expect(findMainPostArticle(document, "https://x.com/home")).toBeNull();
  });
});
