import { describe, expect, it } from "vitest";
import { scoreBand } from "@kavannah/shared";
import { antisemitismCategoryText, contentLabelText, hostOf, humanize, joinWords, verdictText } from "@/lib/labels";
import { disinfoVerdict, engageVerdict, keySources, noteVerdict } from "@/lib/decisions";
import { createPanelStore } from "@/lib/panelStore";
import { detectHostTheme, isDarkColor, parseCssColor } from "@/lib/theme";
import { formatDuration, stripUndefined } from "@/lib/utils";
import { footerText } from "@/components/KavannahPanel";
import { stageIndexFor } from "@/components/StageProgress";
import { makeAnalysis, samplePost } from "./helpers/analysis";

describe("labels", () => {
  it("uses human wording for contract enums", () => {
    expect(contentLabelText("potentially_antisemitic")).toBe("Potentially antisemitic");
    expect(verdictText("insufficient_evidence")).toBe("Insufficient evidence");
    expect(antisemitismCategoryText("holocaust_denial_or_distortion")).toBe("Holocaust denial or distortion");
    expect(humanize("some_new_value")).toBe("Some new value");
    expect(joinWords(["a"])).toBe("a");
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
    expect(hostOf("https://www.lemonde.fr/x")).toBe("lemonde.fr");
    expect(scoreBand(78).label).toBe("Likely misleading");
  });
});

describe("decision verdicts", () => {
  const classify = (score: number, labels: ReturnType<typeof makeAnalysis>["classification"]["labels"]) => ({
    ...makeAnalysis().classification,
    disinformationScore: score,
    labels,
  });
  const evidence = makeAnalysis().evidence;
  const withVerdict = (verdict: (typeof evidence)[number]["verdict"]) => evidence.map((item) => ({ ...item, verdict }));

  it("turns the classification into a one-glance disinformation verdict", () => {
    expect(disinfoVerdict(classify(90, ["misinformation"]), evidence)).toEqual({ label: "Likely misleading", tone: "critical" });
    expect(disinfoVerdict(classify(62, ["factual_claim", "misleading_framing"]), evidence)).toEqual({ label: "Missing context", tone: "warning" });
    expect(disinfoVerdict(classify(62, ["misinformation", "misleading_framing"]), evidence).label).toBe("Potentially misleading");
    expect(disinfoVerdict(classify(30, ["unverifiable_claim"]), evidence).label).toBe("Some concerns");
    expect(disinfoVerdict(classify(5, ["opinion"]), [])).toEqual({ label: "Opinion", tone: "neutral" });
    expect(disinfoVerdict(classify(2, ["factual_claim", "benign"]), withVerdict("supported"))).toEqual({ label: "Accurate", tone: "positive" });
    // Nothing was checked, so "accurate" would overclaim.
    expect(disinfoVerdict(classify(2, ["benign"]), [])).toEqual({ label: "No clear factual issue", tone: "neutral" });
    expect(disinfoVerdict(classify(10, ["factual_claim"]), withVerdict("insufficient_evidence")).label).toBe("No clear factual issue");
  });

  it("words the two recommendations for the section headers", () => {
    expect(engageVerdict("engage").label).toBe("Yes");
    expect(engageVerdict("do_not_engage").label).toBe("No");
    expect(noteVerdict("recommended")).toEqual({ label: "Recommended", tone: "positive" });
    expect(noteVerdict("not_recommended").label).toBe("Not recommended");
  });

  it("picks at most three key sources, deduped, verified first", () => {
    const source = (id: string, verified: boolean, url = `https://example.org/${id}`) => ({ ...evidence[0]!.sources[0]!, id, url, verified });
    const items = [
      { ...evidence[0]!, sources: [source("a", false), source("b", true)] },
      { ...evidence[0]!, claimId: "c2", sources: [source("b2", true, "https://example.org/b"), source("c", true), source("d", true)] },
    ];
    expect(keySources(items).map((s) => s.id)).toEqual(["b", "c", "d"]);
    expect(keySources(items, 5).map((s) => s.id)).toEqual(["b", "c", "d", "a"]);
    expect(keySources([])).toEqual([]);
  });
});

describe("utils", () => {
  it("formats durations", () => {
    expect(formatDuration(420)).toBe("0.4 s");
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });
  it("strips undefined", () => {
    expect(stripUndefined({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
  it("builds the footer line", () => {
    expect(footerText(makeAnalysis().meta)).toBe("Demo fixture: fx-1");
    expect(footerText({ ...makeAnalysis().meta, mode: "live", model: "claude-opus-5-5", durationMs: 42_000 })).toBe(
      "Analyzed in 42 s · claude-opus-5-5",
    );
  });
  it("advances stages every 6 s and holds on the last one", () => {
    expect(stageIndexFor(0)).toBe(0);
    expect(stageIndexFor(6_500)).toBe(1);
    expect(stageIndexFor(24_000)).toBe(4);
    expect(stageIndexFor(90_000)).toBe(4);
  });
});

describe("theme detection", () => {
  it("parses colours and classifies luminance", () => {
    expect(parseCssColor("rgb(0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("rgba(21, 32, 43, 0.5)")).toEqual({ r: 21, g: 32, b: 43, a: 0.5 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("transparent")?.a).toBe(0);
    expect(isDarkColor({ r: 0, g: 0, b: 0, a: 1 })).toBe(true);
    expect(isDarkColor({ r: 255, g: 255, b: 255, a: 1 })).toBe(false);
  });
  it("reads the page background", () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    expect(detectHostTheme(document)).toBe("dark");
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(detectHostTheme(document)).toBe("light");
  });
});

describe("panel store", () => {
  it("opens, closes and notifies subscribers with immutable snapshots", () => {
    const store = createPanelStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState().open));
    const before = store.getState();
    store.open(samplePost, null);
    expect(store.getState()).not.toBe(before);
    expect(store.getState().post).toBe(samplePost);
    store.setNotice("Couldn't read this post");
    store.close();
    expect(store.getState().notice).toBe("Couldn't read this post");
    store.setNotice(null);
    expect(store.getState().open).toBe(false);
    unsubscribe();
    store.open(samplePost, null);
    expect(seen).toEqual([true, true, false, false]);
  });
});
