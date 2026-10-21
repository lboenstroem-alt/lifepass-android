/**
 * The week strip's arithmetic and words (iOS PlanWeekStrip.swift and the
 * strip half of `PlanCopy`), pure so they can be tested on their own.
 *
 * NO TIME SHIFTING. Days are the server's `YYYY-MM-DD` strings in Iceland
 * time (UTC, no daylight saving) and stay strings; a week move is seven
 * calendar days on that calendar, whatever zone the phone is in.
 */
import type { SessionStatusView, WeekDayCell, WeekView } from '../../../health';
import { addServerDays, shortDay, weekdayAbbreviation } from '../../../i18n/format';
import type { Lang } from '../../../i18n';

type Translate = (key: string) => string;

/**
 * The day a week move selects: the Monday of the week `delta` weeks from the
 * one shown (iOS `moveWeek`). Null when the week names no start.
 */
export function movedWeekStart(week: Pick<WeekView, 'weekStartsOn'>, delta: number): string | null {
  if (!week.weekStartsOn) return null;
  return addServerDays(week.weekStartsOn, 7 * delta);
}

/** A cell's status: the server's, else planned for a day in the programme, else none. */
export function cellStatus(cell: Pick<WeekDayCell, 'status' | 'inProgram'>): SessionStatusView {
  return cell.status ?? (cell.inProgram === true ? 'planned' : 'unknown');
}

/** "17" from "2026-09-17", "5" from "2026-10-05" (iOS drops the leading zeros). */
export function dayNumber(date: string): string {
  const last = date.split('-').filter((part) => part.length > 0).pop() ?? '';
  return last.replace(/^0+/, '');
}

/**
 * A status as a WORD (iOS `PlanCopy.statusWord`): status is never colour or
 * shape alone. Rest and an unknown status have no word.
 */
export function statusWord(status: SessionStatusView | null | undefined, t: Translate): string | null {
  switch (status) {
    case 'done':
      return t('a11y.status.done');
    case 'planned':
      return t('a11y.status.planned');
    case 'skipped':
      return t('a11y.status.skipped');
    case 'missed':
      return t('a11y.status.missed');
    default:
      return null;
  }
}

/** The weekday abbreviation a cell shows; a cell without one reads as Monday, as on iOS. */
export function cellWeekday(cell: Pick<WeekDayCell, 'weekday'>, lang: Lang): string {
  return weekdayAbbreviation(cell.weekday ?? 1, lang);
}

/**
 * TalkBack's name for a cell: "Wed 17 Sept, Full body, done".
 *
 * iOS writes the weekday abbreviation in front of `shortDay`, which already
 * begins with the weekday, so VoiceOver says it twice ("Wed Wed 17 Sept").
 * The spec of the strip is "Wed 17 Sep, {title}, done": the date once, here.
 */
export function cellAccessibilityLabel(cell: WeekDayCell, lang: Lang, t: Translate): string {
  const parts = [shortDay(cell.date, lang), cell.title ?? t('plan.today.rest_title')];
  const word = statusWord(cellStatus(cell), t);
  if (word) parts.push(word);
  return parts.join(', ');
}

/** "today", "past" or "future" for `plan_week_day_selected.relative`. */
export function relativeDay(date: string, today: string): 'today' | 'past' | 'future' {
  if (date === today) return 'today';
  return date < today ? 'past' : 'future';
}

/** How far a drag must travel before it counts as a swipe (iOS `DragGesture(minimumDistance: 24)`). */
export const SWIPE_MIN_DISTANCE = 24;

/**
 * What a finished horizontal drag on the strip does: a swipe left is the next
 * week, a swipe right the previous one, each only where the week allows it.
 * A drag that is more vertical than horizontal is the page scrolling.
 */
export function swipeWeekDelta(dx: number, dy: number, canGoBack: boolean, canGoForward: boolean): -1 | 0 | 1 {
  if (Math.hypot(dx, dy) < SWIPE_MIN_DISTANCE) return 0;
  if (Math.abs(dx) <= Math.abs(dy)) return 0;
  if (dx < 0 && canGoForward) return 1;
  if (dx > 0 && canGoBack) return -1;
  return 0;
}
