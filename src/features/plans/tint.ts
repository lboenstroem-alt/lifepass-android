/**
 * A theme colour drawn at an opacity, as SwiftUI's `Color.lpRust.opacity(0.4)`
 * is: derived from the token, so a change to the token reaches these washes
 * too. (A shared helper belongs in src/theme; until F5 exports one, Plans
 * keeps its own.)
 */
import { parseColor } from '../../theme';

export function withOpacity(color: string, opacity: number): string {
  const [r, g, b, a] = parseColor(color);
  const channel = (value: number) => Math.round(value * 255);
  const alpha = Math.round(a * opacity * 1000) / 1000;
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${alpha})`;
}
