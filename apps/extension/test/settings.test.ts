import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_SETTINGS } from "@kavannah/shared";
import { BUILD_BACKEND_URL, defaultSettings, getSettings, normalizeDomain, normalizeSettings, SETTINGS_KEY, setSettings } from "@/lib/settings";

describe("settings storage", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial updates and persists them in browser.storage.local", async () => {
    await setSettings({ mockMode: true });
    const next = await setSettings({ trustedDomains: ["lemonde.fr"], language: "fr" });
    expect(next).toEqual({ ...DEFAULT_SETTINGS, mockMode: true, trustedDomains: ["lemonde.fr"], language: "fr" });
    const stored = await fakeBrowser.storage.local.get(SETTINGS_KEY);
    expect(stored[SETTINGS_KEY]).toEqual(next);
    expect(await getSettings()).toEqual(next);
  });

  it("treats an empty language as unset and ignores undefined patch values", async () => {
    await setSettings({ language: "fr", backendUrl: "http://localhost:1234" });
    const cleared = await setSettings({ language: "", backendUrl: undefined });
    expect(cleared.language).toBeUndefined();
    expect(cleared.backendUrl).toBe("http://localhost:1234");
  });

  it("falls back to defaults for corrupt storage", () => {
    expect(normalizeSettings({ backendUrl: 42 })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ mockMode: true })).toEqual({ ...DEFAULT_SETTINGS, mockMode: true });
  });

  it("validates trusted-source domains as bare domains", () => {
    expect(normalizeDomain("lemonde.fr")).toBe("lemonde.fr");
    expect(normalizeDomain("  https://www.BBC.co.uk/news/article  ")).toBe("bbc.co.uk");
    expect(normalizeDomain("ihra.org.")).toBe("ihra.org");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("build-time backend URL", () => {
  it("fills a missing backendUrl with the build default and keeps the access key", async () => {
    expect(BUILD_BACKEND_URL).toBe(DEFAULT_SETTINGS.backendUrl); // no WXT_BACKEND_URL in tests
    expect(normalizeSettings({ accessKey: "kv_x" })).toEqual({ ...DEFAULT_SETTINGS, backendUrl: BUILD_BACKEND_URL, accessKey: "kv_x" });
    expect(defaultSettings().backendUrl).toBe(BUILD_BACKEND_URL);
    const saved = await setSettings({ accessKey: " kv_y " });
    expect(saved.accessKey).toBe(" kv_y ");
    expect((await getSettings()).accessKey).toBe(" kv_y ");
  });
});
