import {
  API_ROUTES,
  AnalyzePostRequestSchema,
  AnalyzePostResponseSchema,
  DraftRequestSchema,
  DraftResponseSchema,
  FixturesResponseSchema,
  HealthResponseSchema,
  type AnalysisEvent,
  type AnalyzeOptions,
  type AnalyzePostResponse,
  type FixturesResponse,
  type HealthResponse,
} from "@kavannah/shared";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { RoutingProvider } from "./lib/ai/router.js";
import type { ServerConfig } from "./config.js";
import type { ModelProvider } from "./lib/ai/provider.js";
import { analyzePost, AnalysisFailedError } from "./lib/analysis/analyzePost.js";
import { DraftFailedError, generateDraft } from "./lib/analysis/draft.js";
import { ANONYMOUS, authenticate, bearerToken, requireAccessKey, type Principal } from "./lib/auth.js";
import { analysisCacheKey, type TtlCache } from "./lib/cache.js";
import { sendError } from "./lib/http.js";
import { ConcurrencyGate, RATE_LIMIT_WINDOW_MS, SlidingWindowLimiter } from "./lib/limits.js";
import type { Logger } from "./lib/log.js";
import type { UrlValidator } from "./lib/sources/validateUrl.js";
import { FIXTURES } from "./mock/fixtures.js";
import { mockAnalyze, mockDraft } from "./mock/mockProvider.js";

export { sendError } from "./lib/http.js";

export interface AppContext {
  config: ServerConfig;
  /** Live provider; null when the server runs in mock mode. */
  provider: ModelProvider | null;
  cache: TtlCache<AnalyzePostResponse>;
  log: Logger;
  /** Simulated latency for mock responses (tests pass [0, 0]). */
  mockDelayMs?: [number, number];
  /** Injectable URL checker (tests). */
  validateUrl?: UrlValidator;
  /** Per-caller rate limiter for live work; built from the config when omitted. */
  limiter?: SlidingWindowLimiter;
  /** Cap on concurrent live work; built from the config when omitted. */
  gate?: ConcurrencyGate;
}

export function isMockRequest(ctx: AppContext, options: AnalyzeOptions | undefined): boolean {
  return ctx.config.mode === "mock" || options?.mock === true || ctx.provider === null;
}

export function principalOf(res: Response): Principal {
  return (res.locals.principal as Principal | undefined) ?? ANONYMOUS;
}

export const NDJSON = "application/x-ndjson";

/** The client asked for progressive delivery (one JSON object per line as the analysis advances). */
export function wantsStream(req: Request): boolean {
  return (req.get("accept") ?? "").toLowerCase().includes(NDJSON);
}

/**
 * NDJSON writer for one analysis. Headers go out before the first model call so the client sees
 * progress; anything that fails after that is reported as an "error" event on the stream.
 */
export function openStream(_req: Request, res: Response): { send(event: AnalysisEvent): void; end(): void } {
  res.status(200);
  res.setHeader("content-type", `${NDJSON}; charset=utf-8`);
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();
  // The RESPONSE's close event means the client went away (the request's fires as soon as its
  // body has been read, which would silence every write).
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  return {
    send(event) {
      if (closed || res.writableEnded) return;
      res.write(`${JSON.stringify(event)}\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}

/** Rate-limit identity: the key's owner, or the client IP when the server is open. */
function limitId(req: Request, principal: Principal): string {
  return principal.anonymous ? `ip:${req.ip ?? "unknown"}` : `key:${principal.name}`;
}

/**
 * Admission control for work that calls the model. Returns a release function, or null after
 * having sent a 503 (busy) or 429 (rate limited) response.
 */
function admitLiveWork(limiter: SlidingWindowLimiter, gate: ConcurrencyGate, req: Request, res: Response): (() => void) | null {
  const release = gate.tryAcquire();
  if (!release) {
    res.set("retry-after", "30");
    sendError(res, 503, "busy", `The server is already running ${gate.max} analyses. Try again in a moment.`);
    return null;
  }
  const principal = principalOf(res);
  const verdict = limiter.take(limitId(req, principal));
  if (!verdict.allowed) {
    release();
    const minutes = Math.max(1, Math.ceil(verdict.retryAfterMs / 60_000));
    res.set("retry-after", String(Math.ceil(verdict.retryAfterMs / 1000)));
    sendError(
      res,
      429,
      "rate_limited",
      `Rate limit reached: ${limiter.limit} live analyses per hour${principal.anonymous ? "" : ` for "${principal.name}"`}. Try again in about ${minutes} min.`,
    );
    return null;
  }
  return release;
}

export function createRouter(ctx: AppContext): Router {
  const router = Router();
  const keys = ctx.config.accessKeys;
  const auth = requireAccessKey(keys);
  const limiter = ctx.limiter ?? new SlidingWindowLimiter(ctx.config.rateLimitPerHour, RATE_LIMIT_WINDOW_MS);
  const gate = ctx.gate ?? new ConcurrencyGate(ctx.config.maxConcurrent);

  // Open: lets the settings page verify the URL and the key without spending anything.
  router.get(API_ROUTES.health, (req, res) => {
    const token = bearerToken(req);
    const match = keys.length > 0 ? authenticate(keys, token) : null;
    const authInfo: HealthResponse["auth"] =
      keys.length === 0
        ? { required: false, key: "none" }
        : match
          ? { required: true, key: "valid", name: match.name }
          : { required: true, key: token ? "invalid" : "none" };
    const body: HealthResponse = {
      ok: true,
      mode: ctx.config.mode,
      model: ctx.config.model,
      webSearch: ctx.config.mode === "live" && ctx.config.webSearchEnabled && Boolean(ctx.provider?.webSearchAvailable),
      version: ctx.config.version,
      auth: authInfo,
    };
    if (ctx.provider instanceof RoutingProvider) {
      const { judge, fast, search } = ctx.provider.tiers;
      body.models = { judge: judge.model };
      if (fast) body.models.fast = fast.model;
      if (search) body.models.search = search.model;
      if (ctx.config.openRouterFailover) body.models.failover = "openrouter";
    }
    res.json(HealthResponseSchema.parse(body));
  });

  // Open: demo content only.
  router.get(API_ROUTES.fixtures, (_req, res) => {
    const body: FixturesResponse = { fixtures: FIXTURES.map((f) => ({ id: f.id, title: f.title, scenario: f.scenario, post: f.post })) };
    res.json(FixturesResponseSchema.parse(body));
  });

  router.post(API_ROUTES.analyze, auth, async (req, res) => {
    const parsed = AnalyzePostRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Request body does not match AnalyzePostRequest.", parsed.error.issues);
      return;
    }
    const { post, options } = parsed.data;
    const mock = isMockRequest(ctx, options);
    res.locals.mode = mock ? "mock" : "live";
    const streaming = wantsStream(req);

    let response: AnalyzePostResponse;
    if (mock || !ctx.provider) {
      const stream = streaming ? openStream(req, res) : null;
      response = await mockAnalyze(post, options, { delayMs: ctx.mockDelayMs, onProgress: stream ? (progress) => stream.send({ type: "progress", progress }) : undefined });
      const validated = AnalyzePostResponseSchema.parse(response);
      if (stream) {
        stream.send({ type: "result", analysis: validated });
        stream.end();
      } else res.json(validated);
      return;
    }

    const key = analysisCacheKey(post, options?.preferences);
    const cached = options?.refresh ? undefined : ctx.cache.get(key);
    if (cached) {
      res.locals.cache = "hit";
      const validated = AnalyzePostResponseSchema.parse(cached);
      if (streaming) {
        const stream = openStream(req, res);
        stream.send({ type: "result", analysis: validated });
        stream.end();
      } else res.json(validated);
      return;
    }

    const release = admitLiveWork(limiter, gate, req, res);
    if (!release) return;
    // Headers go out now (after admission control), so 401/429/503 above stay plain JSON.
    const stream = streaming ? openStream(req, res) : null;
    try {
      response = await analyzePost(post, options, {
        provider: ctx.provider,
        validateUrl: ctx.validateUrl,
        log: ctx.log,
        onProgress: stream ? (progress) => stream.send({ type: "progress", progress }) : undefined,
      });
    } catch (err) {
      if (!stream) throw err;
      const failed = err instanceof AnalysisFailedError;
      if (!failed) ctx.log.error(`unhandled error on ${req.method} ${req.originalUrl}`, err instanceof Error ? err.stack : err);
      stream.send({ type: "error", error: failed ? { code: "analysis_failed", message: err.message } : { code: "internal_error", message: "Internal server error; see the server log." } });
      stream.end();
      return;
    } finally {
      release();
    }
    ctx.cache.set(key, response);
    // Validation failure here is a server bug → error handler → 500 internal_error.
    const validated = AnalyzePostResponseSchema.parse(response);
    if (stream) {
      stream.send({ type: "result", analysis: validated });
      stream.end();
    } else res.json(validated);
  });

  router.post(API_ROUTES.draft, auth, async (req, res) => {
    const parsed = DraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "Request body does not match DraftRequest.", parsed.error.issues);
      return;
    }
    const request = parsed.data;
    const mock = isMockRequest(ctx, request.options) || request.analysis.meta.mode === "mock";
    res.locals.mode = mock ? "mock" : "live";
    if (mock || !ctx.provider) {
      res.json(DraftResponseSchema.parse(await mockDraft(request, { delayMs: ctx.mockDelayMs })));
      return;
    }
    const release = admitLiveWork(limiter, gate, req, res);
    if (!release) return;
    try {
      const response = await generateDraft(request, { provider: ctx.provider, log: ctx.log });
      res.json(DraftResponseSchema.parse(response));
    } finally {
      release();
    }
  });

  return router;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, "not_found", `No route for ${req.method} ${req.path}`);
};

export function createErrorHandler(ctx: AppContext): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return;
    const e = err as { type?: string; message?: string } | null;
    if (e?.type === "entity.parse.failed") return sendError(res, 400, "invalid_request", "Request body is not valid JSON.");
    if (e?.type === "entity.too.large") return sendError(res, 413, "invalid_request", "Request body exceeds the 1mb limit.");
    if (err instanceof AnalysisFailedError) return sendError(res, 502, "analysis_failed", err.message);
    if (err instanceof DraftFailedError) return sendError(res, 502, "draft_failed", err.message);
    ctx.log.error(`unhandled error on ${req.method} ${req.originalUrl}`, err instanceof Error ? err.stack : err);
    sendError(res, 500, "internal_error", "Internal server error; see the server log.");
  };
}
