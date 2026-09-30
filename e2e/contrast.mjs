/**
 * WCAG 2.2 text-contrast audit (success criterion 1.4.3, level AA), evaluated inside the page.
 *
 * Every visible text node under the root is checked against the colour actually behind it: the
 * ancestor background colours are composited in order on a 1x1 canvas (so translucent tints,
 * `color-mix()`, `oklab()` and friends are all measured exactly as the browser paints them), then
 * the text colour is composited on top, with the element's opacity applied.
 *
 * Thresholds: 4.5:1 for normal text, 3:1 for large text (>= 24px, or >= 18.66px and bold).
 * Exempt, as WCAG allows: text inside disabled controls. Skipped: fully transparent text (opacity 0,
 * e.g. a "Saved" indicator between saves). Not measured: background images.
 *
 * Usage (Playwright):  await page.evaluate(`(${CONTRAST_AUDIT_IN_PAGE})("drawer")`)
 *   "drawer"   the Kavannah drawer inside the content script's shadow root
 *   "document" the whole document body (popup, options page)
 */
export const CONTRAST_AUDIT_IN_PAGE = `(target) => {
  const root =
    target === "drawer"
      ? document.querySelector("kavannah-panel")?.shadowRoot?.querySelector('[role="dialog"]')
      : document.body;
  if (!root) return { error: "audit root not found: " + target, checked: 0, failures: [], minRatio: null };

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const alphaOf = (color) => {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0)";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
  };
  /** Composites layers (bottom first) and returns the resulting sRGB pixel. */
  const paint = (layers) => {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, 1, 1);
    for (const layer of layers) {
      ctx.globalAlpha = layer.alpha ?? 1;
      ctx.fillStyle = "#000000";
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.globalAlpha = 1;
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratioOf = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  const parentOf = (el) => {
    if (el.parentElement) return el.parentElement;
    const rootNode = el.getRootNode();
    return rootNode && rootNode.host ? rootNode.host : null;
  };

  const failures = [];
  const seen = new Set();
  let checked = 0;
  let minRatio = Infinity;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.nodeValue || "").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible") continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue; // screen-reader-only text and collapsed regions
    if (el.closest(":disabled, [aria-disabled='true']")) continue;

    let opacity = 1;
    const layers = [];
    let foundOpaque = false;
    for (let n = el; n; n = parentOf(n)) {
      const s = getComputedStyle(n);
      opacity *= Number(s.opacity);
      const bg = s.backgroundColor;
      const a = alphaOf(bg);
      if (a > 0) {
        layers.push({ color: bg });
        if (a >= 0.999) {
          foundOpaque = true;
          break;
        }
      }
    }
    if (opacity < 0.01 || alphaOf(cs.color) < 0.01) continue; // invisible right now
    layers.reverse();
    if (!foundOpaque) layers.unshift({ color: "#ffffff" });
    const bgRgb = paint(layers);
    const fgRgb = paint([{ color: "rgb(" + bgRgb.join(",") + ")" }, { color: cs.color, alpha: opacity }]);
    const ratio = ratioOf(fgRgb, bgRgb);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    checked += 1;
    if (ratio < minRatio) minRatio = ratio;
    if (ratio + 1e-6 < need) {
      const cls = typeof el.className === "string" ? el.className : "";
      failures.push({
        text: text.slice(0, 70),
        ratio: Math.round(ratio * 100) / 100,
        need,
        fg: hex(fgRgb),
        bg: hex(bgRgb),
        px: size,
        weight,
        cls: cls.slice(0, 90),
      });
    }
  }
  return { checked, failures, minRatio: minRatio === Infinity ? null : Math.round(minRatio * 100) / 100 };
}`;

/** Expands every collapsed disclosure (evidence, glossary, "Show more", …) under `scope`. */
export async function expandAll(scope, { max = 12 } = {}) {
  for (let i = 0; i < max; i += 1) {
    const collapsed = scope.locator('button[aria-expanded="false"]');
    if ((await collapsed.count()) === 0) return i;
    await collapsed.first().click();
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return max;
}
