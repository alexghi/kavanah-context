import {
  API_ROUTES,
  AnalysisEventSchema,
  AnalyzePostResponseSchema,
  ApiErrorSchema,
  DraftResponseSchema,
  FixturesResponseSchema,
  HealthResponseSchema,
  type AnalysisEvent,
  type AnalyzeOptions,
  type AnalyzePostRequest,
  type DraftRequest,
  type ExtensionMessage,
  type ExtensionResponse,
  type Settings,
} from "@kavannah/shared";
import { describeError } from "../utils";

/** Live analysis takes 30-90 s; the brief mandates a 180 s ceiling. */
export const BACKEND_TIMEOUT_MS = 180_000;
/** Progressive analyses: abort when the server sends nothing for this long… */
export const STREAM_INACTIVITY_MS = 120_000;
/** …or when the whole analysis (with the IHRA review) exceeds this. */
export const STREAM_MAX_MS = 360_000;
export const NDJSON = "application/x-ndjson";
/**
 * Chrome may stop an MV3 service worker while a fetch takes longer than 30 s. Calling any
 * extension API resets its idle timer, so the router pings one every 20 s while a request is
 * in flight.
 */
export const KEEPALIVE_INTERVAL_MS = 20_000;

export interface RouterDeps {
  fetch: typeof globalThis.fetch;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  openOptionsPage(): Promise<void>;
  /** Cheap extension API call used as a keep-alive while a backend request is pending. */
  keepAlive?: () => unknown;
  timeoutMs?: number;
}

/** Structural subset of a Zod schema, so the router doesn't depend on Zod's generics. */
interface Validator<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } };
}

export type Failure = { ok: false; error: { code: string; message: string } };

export function fail(code: string, message: string): Failure {
  return { ok: false, error: { code, message } };
}

export function ok<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}

export function networkErrorMessage(backendUrl: string): string {
  return `Can't reach the Kavannah server at ${backendUrl}. Check the Backend URL in Settings; for a local server, start it with \`npm run dev\`.`;
}

/**
 * Request headers: JSON, the person's access key when one is configured (hosted servers), and
 * the header that makes ngrok's free tier skip its browser interstitial (harmless elsewhere).
 */
export function requestHeaders(settings: Settings, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", "ngrok-skip-browser-warning": "1" };
  if (hasBody) headers["content-type"] = "application/json";
  const key = settings.accessKey?.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

export function joinUrl(base: string, route: string): string {
  return `${base.trim().replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("kavannah:");
}

const BACKGROUND_TYPES: ReadonlySet<string> = new Set<ExtensionMessage["type"]>([
  "kavannah:analyze",
  "kavannah:draft",
  "kavannah:health",
  "kavannah:fixtures",
  "kavannah:getSettings",
  "kavannah:setSettings",
  "kavannah:openOptions",
]);

/** Messages the service worker answers (the others are popup -> content script). */
export function isBackgroundMessage(value: unknown): value is ExtensionMessage {
  return isExtensionMessage(value) && BACKGROUND_TYPES.has(value.type);
}

/**
 * Merge the user's settings into the per-request options: demo mode forces `mock`, trusted
 * domains and language become `preferences`. Explicit overrides from the UI win.
 */
export function resolveAnalyzeOptions(settings: Settings, overrides?: AnalyzeOptions): AnalyzeOptions | undefined {
  const preferences: NonNullable<AnalyzeOptions["preferences"]> = {};
  if (settings.trustedDomains.length > 0) preferences.trustedDomains = settings.trustedDomains;
  if (settings.language) preferences.language = settings.language;
  if (overrides?.preferences?.trustedDomains) preferences.trustedDomains = overrides.preferences.trustedDomains;
  if (overrides?.preferences?.language) preferences.language = overrides.preferences.language;

  const options: AnalyzeOptions = {};
  if (overrides?.mock || settings.mockMode) options.mock = true;
  if (overrides?.refresh) options.refresh = true;
  if (Object.keys(preferences).length > 0) options.preferences = preferences;
  return Object.keys(options).length > 0 ? options : undefined;
}

function isTimeoutError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError";
}

export interface Router {
  handle(message: ExtensionMessage): Promise<ExtensionResponse<unknown>>;
  /**
   * Progressive analysis: streams progress events, then exactly one result or error event.
   * Resolves when the stream is over; `signal` aborts it (the page went away).
   */
  analyzeStream(payload: { post: AnalyzePostRequest["post"]; options?: AnalyzeOptions }, onEvent: (event: AnalysisEvent) => void, signal?: AbortSignal): Promise<void>;
  /** Number of backend requests currently pending (exposed for tests). */
  readonly inFlight: number;
}

export function createRouter(deps: RouterDeps): Router {
  const timeoutMs = deps.timeoutMs ?? BACKEND_TIMEOUT_MS;
  let inFlight = 0;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  function trackStart() {
    inFlight += 1;
    if (deps.keepAlive && keepAliveTimer === undefined) {
      keepAliveTimer = setInterval(() => {
        try {
          void deps.keepAlive?.();
        } catch {
          /* keep-alive is best effort */
        }
      }, KEEPALIVE_INTERVAL_MS);
    }
  }

  function trackEnd() {
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0 && keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
  }

  async function callBackend<T>(
    settings: Settings,
    route: string,
    schema: Validator<T>,
    body?: unknown,
  ): Promise<ExtensionResponse<T>> {
    const url = joinUrl(settings.backendUrl, route);
    trackStart();
    try {
      let res: Response;
      try {
        res = await deps.fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: requestHeaders(settings, body !== undefined),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        });
      } catch (err) {
        if (isTimeoutError(err)) {
          return fail(
            "TIMEOUT",
            `The Kavannah server didn't answer within ${Math.round(timeoutMs / 1000)} s. Try again, or check the server logs.`,
          );
        }
        return fail("NETWORK", networkErrorMessage(settings.backendUrl));
      }

      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        return fail(
          "BAD_RESPONSE",
          `The server at ${settings.backendUrl} returned something that isn't JSON (HTTP ${res.status}).`,
        );
      }

      if (!res.ok) {
        const apiError = ApiErrorSchema.safeParse(json);
        if (apiError.success) return fail(apiError.data.error.code, apiError.data.error.message);
        return fail(`HTTP_${res.status}`, `The server answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue && issue.path.length > 0 ? ` (${issue.path.map(String).join(".")})` : "";
        return fail(
          "INVALID_RESPONSE",
          `The server's response didn't match the expected format${where}: ${issue?.message ?? "unknown issue"}.`,
        );
      }
      return ok(parsed.data);
    } finally {
      trackEnd();
    }
  }

  /** Splits an NDJSON body into events as the chunks arrive. */
  async function readEvents(body: ReadableStream<Uint8Array>, onLine: (line: string) => void, onChunk: () => void): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onChunk();
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
        newline = buffer.indexOf("\n");
      }
    }
    const rest = buffer.trim();
    if (rest) onLine(rest);
  }

  async function analyzeStream(payload: { post: AnalyzePostRequest["post"]; options?: AnalyzeOptions }, onEvent: (event: AnalysisEvent) => void, signal?: AbortSignal): Promise<void> {
    const settings = await deps.getSettings();
    const request: AnalyzePostRequest = { post: payload.post, options: resolveAnalyzeOptions(settings, payload.options) };
    const url = joinUrl(settings.backendUrl, API_ROUTES.analyze);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort);
    let inactivity: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const touch = () => {
      if (inactivity !== undefined) clearTimeout(inactivity);
      inactivity = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STREAM_INACTIVITY_MS);
    };
    const hardStop = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_MAX_MS);
    let finished = false;
    const emit = (event: AnalysisEvent) => {
      if (finished) return;
      if (event.type !== "progress") finished = true;
      onEvent(event);
    };
    trackStart();
    try {
      touch();
      let res: Response;
      try {
        res = await deps.fetch(url, {
          method: "POST",
          headers: { ...requestHeaders(settings, true), accept: `${NDJSON}, application/json` },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (err) {
        if (signal?.aborted) return;
        if (timedOut || isTimeoutError(err)) {
          emit({ type: "error", error: { code: "TIMEOUT", message: "The Kavannah server didn't answer in time. Try again, or check the server logs." } });
        } else emit({ type: "error", error: { code: "NETWORK", message: networkErrorMessage(settings.backendUrl) } });
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes(NDJSON) || !res.body) {
        // Plain JSON: an error, or an older server that does not stream.
        const text = await res.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          emit({ type: "error", error: { code: "BAD_RESPONSE", message: `The server at ${settings.backendUrl} returned something that isn't JSON (HTTP ${res.status}).` } });
          return;
        }
        if (!res.ok) {
          const apiError = ApiErrorSchema.safeParse(json);
          emit({ type: "error", error: apiError.success ? apiError.data.error : { code: `HTTP_${res.status}`, message: `The server answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.` } });
          return;
        }
        const parsed = AnalyzePostResponseSchema.safeParse(json);
        if (parsed.success) emit({ type: "result", analysis: parsed.data });
        else emit({ type: "error", error: { code: "INVALID_RESPONSE", message: `The server's response didn't match the expected format: ${parsed.error.issues[0]?.message ?? "unknown issue"}.` } });
        return;
      }
      try {
        await readEvents(
          res.body,
          (line) => {
            let json: unknown;
            try {
              json = JSON.parse(line);
            } catch {
              return; // a damaged line: the final result still validates on its own
            }
            const event = AnalysisEventSchema.safeParse(json);
            if (event.success) emit(event.data);
          },
          touch,
        );
      } catch (err) {
        if (signal?.aborted) return;
        if (timedOut) emit({ type: "error", error: { code: "TIMEOUT", message: "The Kavannah server stopped sending updates. Try again." } });
        else emit({ type: "error", error: { code: "NETWORK", message: `The connection to the Kavannah server was lost: ${describeError(err)}` } });
        return;
      }
      if (!finished) emit({ type: "error", error: { code: "INCOMPLETE", message: "The Kavannah server ended the analysis without a result. Try again." } });
    } finally {
      if (inactivity !== undefined) clearTimeout(inactivity);
      clearTimeout(hardStop);
      signal?.removeEventListener("abort", abort);
      trackEnd();
    }
  }

  async function route(message: ExtensionMessage): Promise<ExtensionResponse<unknown>> {
    switch (message.type) {
      case "kavannah:analyze": {
        const settings = await deps.getSettings();
        const request: AnalyzePostRequest = {
          post: message.payload.post,
          options: resolveAnalyzeOptions(settings, message.payload.options),
        };
        return callBackend(settings, API_ROUTES.analyze, AnalyzePostResponseSchema, request);
      }
      case "kavannah:draft": {
        const settings = await deps.getSettings();
        const request: DraftRequest = {
          ...message.payload,
          options: resolveAnalyzeOptions(settings, message.payload.options),
        };
        return callBackend(settings, API_ROUTES.draft, DraftResponseSchema, request);
      }
      case "kavannah:health": {
        const settings = await deps.getSettings();
        return callBackend(settings, API_ROUTES.health, HealthResponseSchema);
      }
      case "kavannah:fixtures": {
        const settings = await deps.getSettings();
        return callBackend(settings, API_ROUTES.fixtures, FixturesResponseSchema);
      }
      case "kavannah:getSettings":
        return ok(await deps.getSettings());
      case "kavannah:setSettings":
        return ok(await deps.setSettings(message.payload));
      case "kavannah:openOptions":
        await deps.openOptionsPage();
        return ok(null);
      default:
        return fail("UNKNOWN_MESSAGE", `The background worker doesn't handle "${(message as { type: string }).type}".`);
    }
  }

  return {
    async handle(message) {
      try {
        return await route(message);
      } catch (err) {
        return fail("INTERNAL", describeError(err));
      }
    },
    async analyzeStream(payload, onEvent, signal) {
      try {
        await analyzeStream(payload, onEvent, signal);
      } catch (err) {
        onEvent({ type: "error", error: { code: "INTERNAL", message: describeError(err) } });
      }
    },
    get inFlight() {
      return inFlight;
    },
  };
}
