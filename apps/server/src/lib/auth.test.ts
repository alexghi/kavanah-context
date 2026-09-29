import { describe, expect, it } from "vitest";
import { authenticate, generateAccessKey, isValidKeyName, parseAccessKeys } from "./auth.js";

describe("access keys", () => {
  it("parses name:key entries and skips malformed ones without leaking keys", () => {
    const { keys, notices } = parseAccessKeys("alex:kv_alexalexalexalex, judge-1:kv_judgejudgejudgejudge;bad;short:abc,,alex:kv_otherotherotherother");
    expect(keys).toEqual([
      { name: "alex", key: "kv_alexalexalexalex" },
      { name: "judge-1", key: "kv_judgejudgejudgejudge" },
    ]);
    expect(notices).toHaveLength(3);
    expect(notices.join("\n")).not.toContain("kv_alexalexalexalex");
    expect(notices.join("\n")).toContain("duplicate name");
    expect(parseAccessKeys(undefined).keys).toEqual([]);
    expect(parseAccessKeys("").keys).toEqual([]);
  });

  it("rejects duplicate keys and invalid names", () => {
    const { keys, notices } = parseAccessKeys("a:kv_samesamesamesame,b:kv_samesamesamesame,bad name:kv_validvalidvalidvalid");
    expect(keys.map((k) => k.name)).toEqual(["a"]);
    expect(notices).toHaveLength(2);
    expect(isValidKeyName("judge-1")).toBe(true);
    expect(isValidKeyName("-nope")).toBe(false);
    expect(isValidKeyName("a".repeat(33))).toBe(false);
  });

  it("authenticates by exact key only", () => {
    const keys = parseAccessKeys("alex:kv_alexalexalexalex,judge:kv_judgejudgejudgejudge").keys;
    expect(authenticate(keys, "kv_judgejudgejudgejudge")?.name).toBe("judge");
    expect(authenticate(keys, "kv_alexalexalexalex")?.name).toBe("alex");
    expect(authenticate(keys, "kv_alexalexalexale")).toBeNull();
    expect(authenticate(keys, "")).toBeNull();
    expect(authenticate(keys, undefined)).toBeNull();
    expect(authenticate([], "kv_alexalexalexalex")).toBeNull();
  });

  it("generates distinct, well-formed keys", () => {
    const a = generateAccessKey();
    const b = generateAccessKey();
    expect(a).toMatch(/^kv_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(parseAccessKeys(`x:${a}`).keys).toHaveLength(1);
  });
});
