/** Detects whether the host page (X's "Dim"/"Lights out" themes) is dark, from its background colour. */

export type HostTheme = "light" | "dark";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const alphaRaw = rgb[4];
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: Number.isFinite(a) ? a : 1 };
  }
  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1] ?? "";
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

export function isDarkColor({ r, g, b }: Rgba): boolean {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5;
}

export function detectHostTheme(doc: Document): HostTheme | null {
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return null;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    try {
      const color = parseCssColor(view.getComputedStyle(el).backgroundColor);
      if (color && color.a > 0) return isDarkColor(color) ? "dark" : "light";
    } catch {
      /* ignore */
    }
  }
  return null;
}
