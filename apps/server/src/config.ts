import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, type AnalysisMode } from "@kavannah/shared";
import { parseAccessKeys, type AccessKey } from "./lib/auth.js";

import type { Effort } from "./lib/ai/provider.js";
export type { Effort } from "./lib/ai/provider.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const SERVER_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_RATE_LIMIT_PER_HOUR = 30;
export const DEFAULT_MAX_CONCURRENT = 4;

export interface ServerConfig {
  port: number;
  /** Interface to bind: 127.0.0.1 (default, laptop) or 0.0.0.0 (container / hosted). */
  host: string;
  /** The judge tier (classification, verdicts, IHRA review, recommendations, drafts). */
  model: string;
  /** The fast tier (claim extraction, web-search research); "" = same as the judge. */
  modelFast: string;
  /** Backend for the research calls when it differs from the fast tier; "" = fast tier. */
  searchModel: string;
  /** Retry rate-limited / overloaded / timed-out Anthropic calls on OpenRouter (needs KAVANNAH_OPENROUTER_KEY). */
  openRouterFailover: boolean;
  /** KAVANNAH_OPENROUTER_KEY is present (the key itself stays in the environment). */
  hasOpenRouterKey: boolean;
  effort: Effort;
  /** KAVANNAH_MOCK=1 */
  mockForced: boolean;
  hasApiKey: boolean;
  /** KAVANNAH_WEB_SEARCH != "0" */
  webSearchEnabled: boolean;
  /** Effective default mode for requests that do not force mock themselves. */
  mode: AnalysisMode;
  version: string;
  /** Per-person access keys (KAVANNAH_ACCESS_KEYS). Empty = open server. */
  accessKeys: AccessKey[];
  /** KAVANNAH_ALLOW_ANONYMOUS=1: run a live server on a public interface without keys (not recommended). */
  allowAnonymous: boolean;
  /** Live analyses + drafts per key (or per IP when open) per hour; 0 = unlimited. */
  rateLimitPerHour: number;
  /** Live analyses + drafts in flight at once; 0 = unlimited. */
  maxConcurrent: number;
  /** Trust X-Forwarded-* from the reverse proxy in front (Cloud Run, ngrok). */
  trustProxy: boolean;
  /** Human-readable notes produced while resolving the config (e.g. "no API key → mock mode"). */
  notices: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/src → repo root */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

/**
 * Loads `.env` files with Node's built-in loader. Variables already present in the
 * shell win (loadEnvFile never overrides existing values). Returns the files loaded.
 */
export function loadEnv(candidates: string[] = [path.resolve(process.cwd(), ".env"), path.resolve(REPO_ROOT, ".env")]): string[] {
  const loaded: string[] = [];
  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (fs.existsSync(file)) {
      process.loadEnvFile(file);
      loaded.push(file);
    }
  }
  return loaded;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function nonNegativeInt(value: string | undefined, fallback: number, name: string, notices: string[]): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    notices.push(`${name}="${value}" is not a non-negative integer; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const notices: string[] = [];
  // PORT is what Cloud Run (and most hosts) set; KAVANNAH_PORT wins when both are present.
  const port = Number.parseInt(env.KAVANNAH_PORT ?? env.PORT ?? "", 10);
  const host = env.KAVANNAH_HOST?.trim() || DEFAULT_HOST;
  const model = env.KAVANNAH_MODEL?.trim() || DEFAULT_MODEL;
  const hasOpenRouterKey = Boolean(env.KAVANNAH_OPENROUTER_KEY?.trim());
  const needsOpenRouter = (id: string, name: string): string => {
    if (id.includes("/") && !hasOpenRouterKey) {
      notices.push(`${name}="${id}" is an OpenRouter model but KAVANNAH_OPENROUTER_KEY is not set; ignoring it.`);
      return "";
    }
    return id;
  };
  const modelFast = needsOpenRouter(env.KAVANNAH_MODEL_FAST?.trim() ?? "", "KAVANNAH_MODEL_FAST");
  const searchModel = needsOpenRouter(env.KAVANNAH_SEARCH_MODEL?.trim() ?? "", "KAVANNAH_SEARCH_MODEL");
  const openRouterFailover = hasOpenRouterKey && (env.KAVANNAH_OPENROUTER_FAILOVER === undefined || truthy(env.KAVANNAH_OPENROUTER_FAILOVER));
  if (model.includes("/") && !hasOpenRouterKey) notices.push(`KAVANNAH_MODEL="${model}" is an OpenRouter model but KAVANNAH_OPENROUTER_KEY is not set.`);
  const rawEffort = (env.KAVANNAH_EFFORT ?? "medium").trim().toLowerCase();
  let effort: Effort = "medium";
  if (rawEffort === "low" || rawEffort === "medium" || rawEffort === "high") effort = rawEffort;
  else if (rawEffort) notices.push(`KAVANNAH_EFFORT="${rawEffort}" is not low|medium|high; using medium.`);

  const mockForced = truthy(env.KAVANNAH_MOCK);
  const hasApiKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const webSearchEnabled = env.KAVANNAH_WEB_SEARCH === undefined ? true : env.KAVANNAH_WEB_SEARCH.trim() !== "0" && !["false", "off", "no"].includes(env.KAVANNAH_WEB_SEARCH.trim().toLowerCase());

  let mode: AnalysisMode = "live";
  if (mockForced) {
    mode = "mock";
    notices.push("KAVANNAH_MOCK is set: serving built-in demo fixtures, the model is never called.");
  } else if (!hasApiKey) {
    mode = "mock";
    notices.push("ANTHROPIC_API_KEY is not set: falling back to mock mode (built-in demo fixtures). Add the key to .env for live analysis.");
  }

  const parsedKeys = parseAccessKeys(env.KAVANNAH_ACCESS_KEYS);
  notices.push(...parsedKeys.notices);
  const allowAnonymous = truthy(env.KAVANNAH_ALLOW_ANONYMOUS);
  const rateLimitPerHour = nonNegativeInt(env.KAVANNAH_RATE_LIMIT, DEFAULT_RATE_LIMIT_PER_HOUR, "KAVANNAH_RATE_LIMIT", notices);
  const maxConcurrent = nonNegativeInt(env.KAVANNAH_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT, "KAVANNAH_MAX_CONCURRENT", notices);
  const trustProxy = env.KAVANNAH_TRUST_PROXY === undefined ? !isLoopback(host) : truthy(env.KAVANNAH_TRUST_PROXY);

  if (parsedKeys.keys.length === 0 && !isLoopback(host) && mode === "live" && allowAnonymous) {
    notices.push("KAVANNAH_ALLOW_ANONYMOUS is set: anyone who can reach this server can spend your Anthropic credits (rate limits still apply per IP).");
  }

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    host,
    model,
    modelFast,
    searchModel,
    openRouterFailover,
    hasOpenRouterKey,
    effort,
    mockForced,
    hasApiKey,
    webSearchEnabled,
    mode,
    version: SERVER_VERSION,
    accessKeys: parsedKeys.keys,
    allowAnonymous,
    rateLimitPerHour,
    maxConcurrent,
    trustProxy,
    notices,
  };
}

/**
 * Why the server must not start, or null. A live server on a non-loopback interface without
 * access keys would let anyone spend the Anthropic credits.
 */
export function startupBlocker(config: ServerConfig): string | null {
  if (config.mode !== "live") return null;
  if (isLoopback(config.host)) return null;
  if (config.accessKeys.length > 0 || config.allowAnonymous) return null;
  return (
    `Refusing to start: KAVANNAH_HOST=${config.host} exposes live analysis (your Anthropic credits) without access keys. ` +
    "Set KAVANNAH_ACCESS_KEYS (run `npm run keys -- add <name>`) or, to run open on purpose, KAVANNAH_ALLOW_ANONYMOUS=1."
  );
}
