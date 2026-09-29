import type { PostContext } from "@kavannah/shared";

/**
 * Pure DOM -> PostContext extraction for x.com. No browser-extension imports so it runs in jsdom.
 * Never throws on missing optional data; throws PostExtractionError only when there is no text.
 */

export type PostExtractionErrorCode = "NO_TEXT" | "NO_ARTICLE";

export class PostExtractionError extends Error {
  constructor(
    public readonly code: PostExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PostExtractionError";
  }
}

export interface ExtractOptions {
  /** Defaults to `location.href` when available; used as the URL fallback on /status/ pages. */
  locationHref?: string;
}

export const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const TWEET_TEXT = '[data-testid="tweetText"]';
const USER_NAME = '[data-testid="User-Name"]';
const HANDLE_RE = /^@[A-Za-z0-9_]+$/;
const HANDLE_ANYWHERE_RE = /@[A-Za-z0-9_]+/;
const STATUS_ID_RE = /\/status\/(\d+)/;
const X_HOSTS = ["x.com", "twitter.com", "t.co"];

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** True when `el` sits inside a quoted-post container (a div[role=link] wrapping its own tweetText) within `article`. */
export function isInsideQuote(el: Element, article: Element): boolean {
  let node = el.parentElement;
  while (node && node !== article) {
    if (node.tagName === "DIV" && node.getAttribute("role") === "link" && node.querySelector(TWEET_TEXT)) return true;
    node = node.parentElement;
  }
  return false;
}

/** Text nodes and emoji `img[alt]` in document order. Skips buttons ("Show more") and scripts. */
export function collectText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (tag === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt) parts.push(alt);
      return;
    }
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    if (tag === "BUTTON" || tag === "SCRIPT" || tag === "STYLE" || el.getAttribute("role") === "button") return;
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  return parts.join("").replace(/ /g, " ").trim();
}

function allOutsideQuote<T extends Element>(article: Element, selector: string): T[] {
  return Array.from(article.querySelectorAll<T>(selector)).filter((el) => !isInsideQuote(el, article));
}

function firstOutsideQuote<T extends Element>(article: Element, selector: string): T | null {
  return allOutsideQuote<T>(article, selector)[0] ?? null;
}

/** The quoted-post container of an article, if any. */
export function findQuoteContainer(article: Element): Element | null {
  for (const el of Array.from(article.querySelectorAll('div[role="link"]'))) {
    if (el.querySelector(TWEET_TEXT)) return el;
  }
  return null;
}

/** displayName = first meaningful span text; handle = first `@handle` text. */
export function extractAuthor(userName: Element | null): PostContext["author"] | undefined {
  if (!userName) return undefined;
  let displayName: string | undefined;
  let handle: string | undefined;
  for (const span of Array.from(userName.querySelectorAll("span"))) {
    const text = collectText(span);
    if (!text || text === "·") continue;
    if (HANDLE_RE.test(text)) {
      handle ??= text;
      continue;
    }
    if (displayName === undefined && !HANDLE_ANYWHERE_RE.test(text)) displayName = text;
    if (displayName !== undefined && handle !== undefined) break;
  }
  if (!handle) {
    // Some layouts put the handle in an <a> without a span.
    for (const a of Array.from(userName.querySelectorAll("a"))) {
      const text = collectText(a);
      if (HANDLE_RE.test(text)) {
        handle = text;
        break;
      }
    }
  }
  if (!displayName && !handle) return undefined;
  const author: NonNullable<PostContext["author"]> = {};
  if (displayName) author.displayName = displayName;
  if (handle) author.handle = handle;
  return author;
}

function absoluteStatusUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://x.com");
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (match) return `https://x.com/${match[1]}/status/${match[2]}`;
    return STATUS_ID_RE.test(url.pathname) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isExternalLink(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return !X_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Handles in the "Replying to @a @b" line (best effort). */
export function extractReplyingTo(article: Element): string[] | undefined {
  const blocks = Array.from(article.querySelectorAll("div")).filter(
    (div) => !isInsideQuote(div, article) && /^\s*Replying to\b/i.test(div.textContent ?? ""),
  );
  // Ancestors come first in document order; walk from the deepest block upwards.
  for (const block of blocks.reverse()) {
    const handles = unique(
      Array.from(block.querySelectorAll("a, span"))
        .map((el) => (el.textContent ?? "").trim())
        .filter((text) => HANDLE_RE.test(text)),
    );
    if (handles.length > 0) return handles;
  }
  return undefined;
}

function extractContext(article: Element): NonNullable<PostContext["context"]> {
  const context: NonNullable<PostContext["context"]> = {};

  const quote = findQuoteContainer(article);
  if (quote) {
    const quotedTextEl = quote.querySelector(TWEET_TEXT);
    const text = quotedTextEl ? collectText(quotedTextEl) : "";
    if (text) {
      const author = extractAuthor(quote.querySelector(USER_NAME));
      context.quotedPost = author?.handle ? { text, author: author.handle } : { text };
    }
  }

  context.hasMedia = allOutsideQuote(article, '[data-testid="tweetPhoto"], video').length > 0;

  const links = unique(
    allOutsideQuote<HTMLAnchorElement>(article, 'a[href^="http"]')
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href && isExternalLink(href)),
  );
  if (links.length > 0) context.links = links;

  const replyingTo = extractReplyingTo(article);
  if (replyingTo) context.replyingTo = replyingTo;

  return context;
}

export function extractPost(article: Element | null | undefined, options: ExtractOptions = {}): PostContext {
  if (!article) throw new PostExtractionError("NO_ARTICLE", "No post element was found.");

  const textEl = firstOutsideQuote<HTMLElement>(article, TWEET_TEXT);
  const text = textEl ? collectText(textEl) : "";
  if (!text) {
    throw new PostExtractionError("NO_TEXT", "This post has no text to analyze (media-only posts aren't supported yet).");
  }

  const locationHref =
    options.locationHref ?? (typeof location !== "undefined" && location ? location.href : undefined);

  let url: string | undefined;
  for (const a of allOutsideQuote<HTMLAnchorElement>(article, 'a[href*="/status/"]')) {
    if (a.querySelector("time")) {
      url = absoluteStatusUrl(a.getAttribute("href"));
      if (url) break;
    }
  }
  if (!url && locationHref && STATUS_ID_RE.test(locationHref)) url = locationHref;
  if (!url) {
    // Any status link in the post header (e.g. .../status/<id>/analytics) still carries the id.
    for (const a of allOutsideQuote<HTMLAnchorElement>(article, 'a[href*="/status/"]')) {
      url = absoluteStatusUrl(a.getAttribute("href"));
      if (url) break;
    }
  }
  if (!url) url = locationHref || "https://x.com/";

  const post: PostContext = { platform: "x", url, text };

  const id = url.match(STATUS_ID_RE)?.[1];
  if (id) post.id = id;

  const author = extractAuthor(firstOutsideQuote(article, USER_NAME));
  if (author) post.author = author;

  const language = textEl?.getAttribute("lang");
  if (language) post.language = language;

  const postedAt = firstOutsideQuote<HTMLTimeElement>(article, "time[datetime]")?.getAttribute("datetime");
  if (postedAt) post.postedAt = postedAt;

  post.context = extractContext(article);
  return post;
}

/**
 * On a `/status/<id>` page, the article whose (non-quoted) status link carries that id; else the
 * first article. Returns null when the URL isn't a post page.
 */
export function findMainPostArticle(root: ParentNode, locationHref: string): HTMLElement | null {
  const id = locationHref.match(STATUS_ID_RE)?.[1];
  if (!id) return null;
  const articles = Array.from(root.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  const re = new RegExp(`/status/${id}(?:[/?#]|$)`);
  for (const article of articles) {
    const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
    if (links.some((a) => !isInsideQuote(a, article) && re.test(a.getAttribute("href") ?? ""))) return article;
  }
  return articles[0] ?? null;
}
