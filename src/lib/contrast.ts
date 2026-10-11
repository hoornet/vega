// WCAG 2 contrast between two sRGB colours given as #rrggbb.
//
// Used by the theme tests: the rules a theme must meet are written as ratios,
// computed from the values in themes.ts, so a theme cannot drift below them.

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio, from 1 (same colour) to 21 (black on white). Order does not matter. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The colour seen when `fg` is painted at `alpha` over an opaque `bg`.
 *
 * For tints such as `bg-accent/10`. Plain sRGB mixing, which is what a
 * translucent layer does on screen. (Tailwind 4 mixes in oklab, which differs
 * by a fraction of a contrast step at these alphas; the rules that use this
 * keep a margin.)
 */
export function over(fg: string, alpha: number, bg: string): string {
  const parts = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const f = parts(fg);
  const b = parts(bg);
  return "#" + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}
