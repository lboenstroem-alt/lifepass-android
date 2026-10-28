// A token at an opacity, as SwiftUI's `Color.opacity(_:)` draws it (the
// state chip's 12 % fill and 35 % stroke).
import { parseColor } from '../../../theme';

export function tint(color: string, opacity: number): string {
  const [r, g, b, a] = parseColor(color);
  const channel = (value: number) => Math.round(value * 255);
  const alpha = Math.round(a * opacity * 1000) / 1000;
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${alpha})`;
}
