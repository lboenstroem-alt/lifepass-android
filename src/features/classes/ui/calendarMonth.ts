// The full-schedule calendar's month arithmetic, on the venue's calendar
// (Reykjavík = UTC): pure, so the grid is a unit test.
import { isoDay, startOfIsoDay } from '../feed/days';

/** A month: its year and 0-based month. */
export interface Month {
  readonly year: number;
  readonly month: number;
}

export function monthOf(dayIso: string): Month {
  const day = startOfIsoDay(dayIso) ?? new Date();
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() };
}

export function monthIndex(month: Month): number {
  return month.year * 12 + month.month;
}

export function shiftMonth(month: Month, by: number): Month {
  const index = monthIndex(month) + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

/** The month's grid, Monday first: null for the blanks before the 1st and after the last day. */
export function monthGrid(month: Month): (string | null)[] {
  const first = new Date(Date.UTC(month.year, month.month, 1));
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(isoDay(new Date(Date.UTC(month.year, month.month, day))));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
