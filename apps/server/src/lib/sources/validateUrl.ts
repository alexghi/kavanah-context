export interface UrlCheck {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ValidateUrlOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type UrlValidator = (url: string) => Promise<UrlCheck>;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Kavannah/0.1";

const HEADERS = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** undici wraps network/TLS problems as "fetch failed" with the real reason in `cause`. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code;
    return `${err.message}: ${code ? `${code} ` : ""}${cause.message}`.trim();
  }
  return err.message;
}

/**
 * Confirms that a URL resolves: HEAD first, then GET (without reading the body) when the
 * server rejects HEAD. Short timeout, http(s) only. Never throws.
 */
export async function validateUrl(url: string, options: ValidateUrlOptions = {}): Promise<UrlCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, ok: false, error: "invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url, ok: false, error: "unsupported protocol" };
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchImpl = options.fetchImpl ?? fetch;

  const attempt = async (method: "HEAD" | "GET"): Promise<number> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method, redirect: "follow", signal: controller.signal, headers: HEADERS });
      if (method === "GET") {
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
        }
      }
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let status = await attempt("HEAD");
    if (status < 200 || status >= 400) {
      // Some servers reject HEAD (405/403/404/5xx); confirm with GET before giving up.
      status = await attempt("GET");
    }
    return { url, ok: status >= 200 && status < 400, status };
  } catch (err) {
    if (isAbort(err)) return { url, ok: false, error: `timeout after ${timeoutMs}ms` };
    return { url, ok: false, error: describeError(err) };
  }
}

/** Validates several URLs in parallel (bounded concurrency). */
export async function validateUrls(
  urls: string[],
  validator: UrlValidator = (u) => validateUrl(u),
  concurrency = 6,
): Promise<Map<string, UrlCheck>> {
  const results = new Map<string, UrlCheck>();
  const queue = [...new Set(urls)];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      results.set(url, await validator(url));
    }
  });
  await Promise.all(workers);
  return results;
}
