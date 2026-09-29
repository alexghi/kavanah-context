import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { sendError } from "./http.js";

/**
 * Per-person access keys for a hosted server.
 *
 * Configured with KAVANNAH_ACCESS_KEYS="alex:kv_…,judge-1:kv_…" (entries separated by commas,
 * semicolons or newlines). Callers send `Authorization: Bearer <key>` (or `X-Kavannah-Key`).
 * With no keys configured the server is open, which is only acceptable on 127.0.0.1.
 */
export interface AccessKey {
  name: string;
  key: string;
}

/** Who is making the request, as far as the API is concerned. */
export interface Principal {
  name: string;
  anonymous: boolean;
}

export const ANONYMOUS: Principal = { name: "anonymous", anonymous: true };

export const KEY_PREFIX = "kv_";
export const MIN_KEY_LENGTH = 16;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

/** 32 URL-safe characters after the prefix (192 bits). */
export function generateAccessKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function isValidKeyName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

function redact(value: string): string {
  return value.length <= 8 ? "***" : `${value.slice(0, 4)}…`;
}

/** Parses the env value. Malformed entries are skipped with a notice; keys never appear in notices. */
export function parseAccessKeys(raw: string | undefined): { keys: AccessKey[]; notices: string[] } {
  const keys: AccessKey[] = [];
  const notices: string[] = [];
  const names = new Set<string>();
  const seen = new Set<string>();
  for (const entry of (raw ?? "").split(/[,;\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0 || colon === trimmed.length - 1) {
      notices.push(`KAVANNAH_ACCESS_KEYS: ignoring entry "${redact(trimmed)}" (expected name:key).`);
      continue;
    }
    const name = trimmed.slice(0, colon).trim();
    const key = trimmed.slice(colon + 1).trim();
    if (!isValidKeyName(name)) {
      notices.push(`KAVANNAH_ACCESS_KEYS: ignoring key with invalid name "${name}" (letters, digits, . _ - only).`);
      continue;
    }
    if (key.length < MIN_KEY_LENGTH) {
      notices.push(`KAVANNAH_ACCESS_KEYS: ignoring key for "${name}" (shorter than ${MIN_KEY_LENGTH} characters).`);
      continue;
    }
    if (names.has(name)) {
      notices.push(`KAVANNAH_ACCESS_KEYS: duplicate name "${name}"; keeping the first key.`);
      continue;
    }
    if (seen.has(key)) {
      notices.push(`KAVANNAH_ACCESS_KEYS: the key for "${name}" duplicates another entry; ignored.`);
      continue;
    }
    names.add(name);
    seen.add(key);
    keys.push({ name, key });
  }
  return { keys, notices };
}

/** `Authorization: Bearer <key>` first, then `X-Kavannah-Key`. */
export function bearerToken(req: Request): string | undefined {
  const header = req.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1]!.trim() || undefined;
  }
  const alt = req.get("x-kavannah-key");
  return alt?.trim() || undefined;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time lookup: every configured key is compared, whatever matches. */
export function authenticate(keys: AccessKey[], token: string | undefined): AccessKey | null {
  if (!token) return null;
  const wanted = digest(token);
  let match: AccessKey | null = null;
  for (const candidate of keys) {
    if (timingSafeEqual(digest(candidate.key), wanted)) match = candidate;
  }
  return match;
}

export const MISSING_KEY_MESSAGE =
  "This Kavannah server requires an access key. Open Kavannah's settings and paste the key you were given.";
export const INVALID_KEY_MESSAGE =
  "The access key was not accepted. Check it in Kavannah's settings or ask for a new one.";

/**
 * Express middleware. With no keys configured every request is anonymous (open server);
 * otherwise a valid bearer key is required and `res.locals.principal` names its owner.
 */
export function requireAccessKey(keys: AccessKey[]): RequestHandler {
  return (req, res, next) => {
    if (keys.length === 0) {
      res.locals.principal = ANONYMOUS;
      next();
      return;
    }
    const token = bearerToken(req);
    const match = authenticate(keys, token);
    if (!match) {
      res.set("www-authenticate", 'Bearer realm="kavannah"');
      sendError(res, 401, "unauthorized", token ? INVALID_KEY_MESSAGE : MISSING_KEY_MESSAGE);
      return;
    }
    const principal: Principal = { name: match.name, anonymous: false };
    res.locals.principal = principal;
    next();
  };
}
