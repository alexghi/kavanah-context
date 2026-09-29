import type Anthropic from "@anthropic-ai/sdk";
import type { CandidateSource } from "../ai/provider.js";

export const MAX_CANDIDATES = 12;

export interface CandidateExtraction {
  candidates: CandidateSource[];
  /** Number of web_search tool invocations seen. */
  searches: number;
  queries: string[];
  /** error_code values from web_search_tool_result error objects. */
  toolErrors: string[];
  /** Concatenated assistant text (research notes). */
  notes: string;
}

export function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Dedupe key: scheme+host lowercased, no fragment, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    let s = u.toString();
    if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

function isHttpUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Walks a Messages API response `content` array and collects candidate sources from
 * `web_search_tool_result` blocks and from `web_search_result_location` citations on
 * text blocks. Sources are deduped by URL and capped. Nothing is invented: a candidate
 * exists only because the search tool returned it or the model cited it.
 */
export function extractCandidateSources(
  content: ReadonlyArray<Anthropic.Messages.ContentBlock>,
  options: { max?: number } = {},
): CandidateExtraction {
  const max = options.max ?? MAX_CANDIDATES;
  const byKey = new Map<string, CandidateSource>();
  const ordered: CandidateSource[] = [];
  const queries: string[] = [];
  const toolErrors: string[] = [];
  const notes: string[] = [];
  let searches = 0;

  const add = (raw: { url: unknown; title?: unknown; pageAge?: unknown; snippet?: unknown }) => {
    if (!isHttpUrl(raw.url)) return;
    const key = normalizeUrl(raw.url);
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const snippet = typeof raw.snippet === "string" ? raw.snippet.trim() : "";
    const pageAge = typeof raw.pageAge === "string" ? raw.pageAge : undefined;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      if (!existing.snippet && snippet) existing.snippet = snippet;
      if (!existing.pageAge && pageAge) existing.pageAge = pageAge;
      return;
    }
    if (ordered.length >= max) return;
    const candidate: CandidateSource = {
      id: `s${ordered.length + 1}`,
      url: raw.url,
      title: title || publisherFromUrl(raw.url) || raw.url,
      publisher: publisherFromUrl(raw.url),
    };
    if (pageAge) candidate.pageAge = pageAge;
    if (snippet) candidate.snippet = snippet;
    byKey.set(key, candidate);
    ordered.push(candidate);
  };

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "server_tool_use": {
        if (block.name === "web_search") {
          searches += 1;
          const input = block.input as { query?: unknown } | null | undefined;
          if (input && typeof input.query === "string") queries.push(input.query);
        }
        break;
      }
      case "web_search_tool_result": {
        const result = block.content;
        if (Array.isArray(result)) {
          for (const item of result) {
            if (item && item.type === "web_search_result") {
              add({ url: item.url, title: item.title, pageAge: item.page_age });
            }
          }
        } else if (result && typeof result === "object" && "error_code" in result) {
          toolErrors.push(String(result.error_code));
        }
        break;
      }
      case "text": {
        if (typeof block.text === "string" && block.text.trim()) notes.push(block.text);
        if (Array.isArray(block.citations)) {
          for (const citation of block.citations) {
            if (citation && citation.type === "web_search_result_location") {
              add({ url: citation.url, title: citation.title ?? "", snippet: citation.cited_text });
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return { candidates: ordered, searches, queries, toolErrors, notes: notes.join("\n").trim() };
}
