/**
 * The weight chart's arithmetic, apart from the drawing so a test can hold
 * it: where each week sits, the y range, and the smoothed line (iOS draws it
 * with Swift Charts: `LineMark` with `.catmullRom`, a dashed `RuleMark` at
 * the target, `chartYScale` as `WeightChartDomain` sets it).
 */
import type { WeightTrendWeek } from '../api';

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartDomain {
  readonly low: number;
  readonly high: number;
}

/**
 * The y range (iOS `WeightChartDomain`):
 *
 * - WITH A TARGET the range is explicit, so the target line is never drawn
 *   off the chart: the lowest and highest of the weights AND the target, a
 *   kilo either side.
 * - WITHOUT ONE, Swift Charts' automatic scale that does not include zero:
 *   the weights' own range, out to whole kilos, at least a kilo tall so a
 *   flat line sits in the middle rather than on an edge.
 */
export function chartDomain(values: readonly number[], targetKg: number | null): ChartDomain {
  const all = targetKg === null ? [...values] : [...values, targetKg];
  if (all.length === 0) return { low: 0, high: 1 };
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (targetKg !== null) return { low: min - 1, high: max + 1 };
  let low = Math.floor(min);
  let high = Math.ceil(max);
  if (high - low < 1) {
    low -= 0.5;
    high += 0.5;
  }
  return { low, high };
}

/**
 * Each week with an average, placed in a `width` x `height` box: x evenly
 * spaced in order, first week at the left edge and last at the right, y by
 * its weight in `domain`, heavier higher. `inset` keeps the stroke inside
 * the box at the extremes.
 *
 * Evenly, not by date: iOS plots `x: .value("week", week.weekStartsOn)`, a
 * String, which Swift Charts treats as categories, and `chartWeeks` has
 * already dropped the weeks with no average. So a week the member logged
 * nothing in takes no room on iOS's line, and the line here has the same
 * shape and slope.
 */
export function chartPoints(
  weeks: readonly WeightTrendWeek[],
  size: { readonly width: number; readonly height: number; readonly inset?: number },
  domain: ChartDomain,
): ChartPoint[] {
  const inset = size.inset ?? 0;
  const usable = weeks.filter((week): week is WeightTrendWeek & { avgKg: number } => week.avgKg !== null);
  if (usable.length === 0) return [];
  const steps = usable.length - 1;
  const plotHeight = Math.max(0, size.height - inset * 2);
  return usable.map((week, index) => ({
    x: steps > 0 ? (index / steps) * size.width : size.width / 2,
    y: yFor(week.avgKg, domain, plotHeight) + inset,
  }));
}

/** The y of a weight in a plot `height` tall (0 at the top). */
export function yFor(kg: number, domain: ChartDomain, height: number): number {
  const range = domain.high - domain.low;
  if (range <= 0) return height / 2;
  return ((domain.high - kg) / range) * height;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An SVG path through every point, smoothed the way `.catmullRom` smooths it:
 * a uniform Catmull-Rom spline written as cubic Béziers, so the line passes
 * through each weekly average exactly. One point is a dot-length move; none
 * is an empty path.
 */
export function smoothPath(points: readonly ChartPoint[]): string {
  if (points.length === 0) return '';
  const start = points[0]!;
  if (points.length === 1) return `M${round(start.x)} ${round(start.y)}`;
  let path = `M${round(start.x)} ${round(start.y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return path;
}
