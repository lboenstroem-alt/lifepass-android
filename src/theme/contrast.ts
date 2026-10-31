// WCAG 2 contrast for the colour tokens: a port of the arithmetic in the iOS
// BookingContrastTests (2.5.4), so the readable-contrast tokens can be held
// to 4.5:1 by a test here too, and a screen can check a pair it invents.
//
// A translucent colour is composited over its background first, the way it is
// drawn: `paper3` is ink at 48 %, so its contrast depends on what it sits on.

/** An sRGB colour with channels and alpha in 0..1. */
export type Rgba = [number, number, number, number];

/** Parses `#RGB`, `#RRGGBB`, `#RRGGBBAA` and `rgb(...)` / `rgba(...)`. */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.replace(/./g, (c) => c + c);
    const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return [channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) : 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (fn) {
    return [Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255, fn[4] === undefined ? 1 : Number(fn[4])];
  }
  throw new Error(`Unreadable colour: ${value}`);
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Relative luminance of `color` composited over `background`. */
export function luminance(color: string, background = '#FFFFFF'): number {
  const fg = parseColor(color);
  const bg = parseColor(background);
  const mix = (i: number) => fg[i] * fg[3] + bg[i] * (1 - fg[3]);
  return 0.2126 * linear(mix(0)) + 0.7152 * linear(mix(1)) + 0.0722 * linear(mix(2));
}

/**
 * The contrast ratio of `text` drawn on `background` (1 to 21). The background
 * itself is composited over white, as the iOS test does, so a translucent
 * wash reads as it looks on the page.
 */
export function contrastRatio(text: string, background: string): number {
  const backgroundOnWhite = luminance(background, '#FFFFFF');
  const bgOpaque = (() => {
    const [r, g, b, a] = parseColor(background);
    const over = (c: number) => Math.round((c * a + (1 - a)) * 255);
    return `rgb(${over(r)},${over(g)},${over(b)})`;
  })();
  const a = luminance(text, bgOpaque);
  const b = backgroundOnWhite;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
