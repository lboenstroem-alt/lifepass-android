/**
 * The date step's month grid, on the VENUE's calendar (Reykjavík, which is
 * UTC with no daylight saving), the way iOS pins its graphical DatePicker to
 * `ClassesViewModel.venueTimeZone`: the day picked here is the day the
 * timetable asks the server for, whatever zone the phone is on. Days are
 * `YYYY-MM-DD` strings, never phone-zone Dates. Weeks start on Monday, as the
 * en_GB and is_IS calendars iOS uses do.
 */
import { addServerDays, calendarWords, dateFromServerDay, formatDateTemplate, isoWeekday, venueDate } from '../../i18n/format';
import type { Lang } from '../../i18n';

/** A calendar month (`month` is 1 to 12). */
export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

/** The month a day falls in. */
export function monthOf(day: string): CalendarMonth {
  const [year, month] = day.split('-').map(Number) as [number, number];
  return { year, month };
}

/** The month `delta` months from `month`. */
export function addMonths({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** True when `a` is before `b`. */
export function monthBefore(a: CalendarMonth, b: CalendarMonth): boolean {
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** The month's first day. */
export function firstDay({ year, month }: CalendarMonth): string {
  return `${pad(year, 4)}-${pad(month, 2)}-01`;
}

/**
 * The month as weeks of seven cells, Monday first: each a day, or null before
 * the 1st and after the last day.
 */
export function monthGrid(calendarMonth: CalendarMonth): (string | null)[][] {
  const first = firstDay(calendarMonth);
  const leading = (isoWeekday(first) ?? 1) - 1;
  const cells: (string | null)[] = Array<string | null>(leading).fill(null);
  let day: string | null = first;
  while (day && monthOf(day).month === calendarMonth.month) {
    cells.push(day);
    day = addServerDays(day, 1);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "October 2026" / "október 2026". */
export function monthTitle(calendarMonth: CalendarMonth, lang: Lang): string {
  const date = dateFromServerDay(firstDay(calendarMonth));
  return date ? formatDateTemplate(date, 'MMMMy', lang) : '';
}

/** The weekday column heads, Monday first ("Mon" … "Sun" / "mán." … "sun."). */
export function weekdayHeads(lang: Lang): string[] {
  const words = calendarWords(lang).weekdaysShort;
  return [...words.slice(1), words[0]!];
}

/** The day's number in its month ("7"). */
export function dayNumber(day: string): string {
  return String(Number(day.slice(8, 10)));
}

/** What TalkBack reads for a day: "25 September 2026" / "25. september 2026". */
export function dayLabel(day: string, lang: Lang): string {
  const date = dateFromServerDay(day);
  return date ? venueDate(date, lang) : day;
}
