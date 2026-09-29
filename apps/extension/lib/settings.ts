import { browser } from "wxt/browser";
import { DEFAULT_BACKEND_URL, DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@kavannah/shared";
import { stripUndefined } from "./utils";

/** Single key in browser.storage.local holding the whole settings object. */
export const SETTINGS_KEY = "kavannah:settings";

/**
 * Backend URL baked in at build time: `WXT_BACKEND_URL=https://… npm run build` produces an
 * extension that points at a hosted server out of the box. Falls back to the local default.
 */
export const BUILD_BACKEND_URL: string = (import.meta.env.WXT_BACKEND_URL as string | undefined)?.trim() || DEFAULT_BACKEND_URL;

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, backendUrl: BUILD_BACKEND_URL };
}

/** Coerce whatever is in storage into a valid Settings object (defaults for anything missing). */
export function normalizeSettings(raw: unknown): Settings {
  const candidate = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (candidate.language === "") delete candidate.language;
  if (candidate.backendUrl === undefined) candidate.backendUrl = BUILD_BACKEND_URL;
  const parsed = SettingsSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return defaultSettings();
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

/**
 * Merge a partial update into the stored settings. `undefined` values are ignored;
 * `language: ""` (the cleared form field) unsets the language.
 */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged: Record<string, unknown> = { ...current, ...stripUndefined(patch as Record<string, unknown>) };
  if (merged.language === "") delete merged.language;
  const next = normalizeSettings(merged);
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Subscribe to settings changes made from any extension context. Returns an unsubscribe. */
export function watchSettings(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const change = changes[SETTINGS_KEY];
    if (change) callback(normalizeSettings(change.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Bare domain validation for the "Trusted sources" chips, e.g. `lemonde.fr`, `bbc.co.uk`. */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // protocol
  value = value.replace(/^www\./, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  const ok = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
  return ok ? value : null;
}
