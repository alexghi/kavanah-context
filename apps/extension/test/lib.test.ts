import { describe, expect, it } from "vitest";
import { scoreBand } from "@kavannah/shared";
import { antisemitismCategoryText, contentLabelText, hostOf, humanize, joinWords, verdictText } from "@/lib/labels";
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
