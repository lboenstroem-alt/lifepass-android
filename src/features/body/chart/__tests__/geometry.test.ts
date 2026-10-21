/**
 * The weight chart's arithmetic: the y range with and without a target (iOS
 * `WeightChartDomain`), weeks placed by their dates, and a smoothed line that
 * passes through every weekly average.
 */
import { chartDomain, chartPoints, smoothPath, yFor } from '../geometry';

const week = (weekStartsOn: string, avgKg: number | null) => ({ weekStartsOn, avgKg, count: avgKg === null ? 0 : 2 });

describe('the y range', () => {
  it('with a target: the weights AND the target, a kilo either side, so the line is never off the chart', () => {
    expect(chartDomain([74.8, 72.5], 68)).toEqual({ low: 67, high: 75.8 });
    expect(chartDomain([74.8, 72.5], 80)).toEqual({ low: 71.5, high: 81 });
  });

  it('without one: the weights out to whole kilos, never down to zero', () => {
    expect(chartDomain([74.8, 72.5], null)).toEqual({ low: 72, high: 75 });
  });

  it('a flat line still gets a range to sit in the middle of', () => {
    const domain = chartDomain([72, 72], null);
    expect(domain.high - domain.low).toBe(1);
    expect(yFor(72, domain, 100)).toBe(50);
  });
});

describe('the points', () => {
  it('heavier is higher, and the range fills the box', () => {
    const points = chartPoints([week('2026-08-03', 75), week('2026-08-10', 72)], { width: 200, height: 100 }, { low: 72, high: 75 });
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 100 },
    ]);
  });

  it('a week with no average leaves its gap: x is the date, not the index', () => {
    const points = chartPoints(
      [week('2026-08-03', 74), week('2026-08-10', null), week('2026-08-17', 73), week('2026-08-24', 72)],
      { width: 300, height: 100 },
      { low: 72, high: 74 },
    );
    expect(points.map((p) => p.x)).toEqual([0, 200, 300]);
  });

  it('the inset keeps the stroke inside the box', () => {
    const points = chartPoints([week('2026-08-03', 75), week('2026-08-10', 72)], { width: 100, height: 104, inset: 2 }, { low: 72, high: 75 });
    expect(points.map((p) => p.y)).toEqual([2, 102]);
  });
});

describe('the line', () => {
  it('passes through every point (a cubic segment ends on each)', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 50, y: 40 },
      { x: 100, y: 20 },
    ];
    const path = smoothPath(points);
    expect(path.startsWith('M0 10')).toBe(true);
    expect(path.split('C')).toHaveLength(points.length);
    expect(path).toContain(' 50 40 C');
    expect(path.endsWith(' 100 20')).toBe(true);
  });

  it('no points draw nothing; one is a move', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M5 5');
  });
});
