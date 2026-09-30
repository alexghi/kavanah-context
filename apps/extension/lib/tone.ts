import { CircleCheck, CircleMinus, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Tone } from "@kavannah/shared";

/**
 * Tailwind classes per tone (tokens in entrypoints/kavannah.content/style.css). Written out in
 * full so Tailwind's scanner sees every class.
 * - text: the "-strong" shade, >= 6:1 on the card and on the tone's own tint
 * - fill: the base colour, for bars, dots and icons (never text)
 * - track: a faint version of the fill, for inactive segments
 * - soft / line: tinted background and matching border for chips and boxes
 */
export interface ToneClasses {
  text: string;
  fill: string;
  track: string;
  soft: string;
  line: string;
}

export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  critical: {
    text: "text-critical-strong",
    fill: "bg-critical",
    track: "bg-critical/25",
    soft: "bg-critical-soft",
    line: "border-critical-line",
  },
  warning: {
    text: "text-warning-strong",
    fill: "bg-warning",
    track: "bg-warning/25",
    soft: "bg-warning-soft",
    line: "border-warning-line",
  },
  caution: {
    text: "text-caution-strong",
    fill: "bg-caution",
    track: "bg-caution/25",
    soft: "bg-caution-soft",
    line: "border-caution-line",
  },
  positive: {
    text: "text-positive-strong",
    fill: "bg-positive",
    track: "bg-positive/25",
    soft: "bg-positive-soft",
    line: "border-positive-line",
  },
  neutral: {
    text: "text-neutral-strong",
    fill: "bg-neutral",
    track: "bg-neutral/25",
    soft: "bg-neutral-soft",
    line: "border-neutral-line",
  },
};

/**
 * Every coloured chip also carries an icon, so its meaning never depends on colour alone
 * (WCAG 1.4.1): octagon = serious problem, triangle = concern, check = fine, minus = neutral.
 */
export const TONE_ICON: Record<Tone, LucideIcon> = {
  critical: OctagonAlert,
  warning: TriangleAlert,
  caution: TriangleAlert,
  positive: CircleCheck,
  neutral: CircleMinus,
};
