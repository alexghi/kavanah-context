import { describe, expect, it } from "vitest";
import { TEST_POST } from "../test/fakeProvider.js";
import { TtlCache, analysisCacheKey } from "./cache.js";

describe("TtlCache", () => {
  it("expires entries after the TTL", () => {
    let now = 1000;
    const cache = new TtlCache<string>(100, () => now);
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    now = 1099;
    expect(cache.get("a")).toBe("1");
    now = 1100;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("analysisCacheKey", () => {
  it("depends on the URL and normalized preferences only", () => {
    const a = analysisCacheKey(TEST_POST, { trustedDomains: ["B.org", "a.org"] });
    const b = analysisCacheKey({ ...TEST_POST, text: "different text" }, { trustedDomains: ["a.org", "b.org "] });
    expect(a).toBe(b);
    expect(analysisCacheKey(TEST_POST, undefined)).not.toBe(a);
    expect(analysisCacheKey(TEST_POST, undefined)).toBe(analysisCacheKey(TEST_POST, { trustedDomains: [] }));
    expect(analysisCacheKey(TEST_POST, { language: "fr" })).not.toBe(analysisCacheKey(TEST_POST, { language: "de" }));
    expect(analysisCacheKey({ ...TEST_POST, url: "https://x.com/a/status/2" }, undefined)).not.toBe(analysisCacheKey(TEST_POST, undefined));
  });
});
