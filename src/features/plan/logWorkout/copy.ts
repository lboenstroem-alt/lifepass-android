/**
 * The Log a workout sheet's own words, as pure functions over a translator
 * (iOS `LogWorkoutCopy`, Views/Plan/LogWorkoutSheet.swift).
 *
 * The extra's line on the card ("Extra workout · Gym · 45 min"), its spoken
 * minutes and its Remove label are the Today card's (../today/copy.ts); the
 * sheet reads `spokenMinutes` from there too, so both say it the same way.
 */
import type { Lang, Params } from '../../../i18n';
import { addServerDays, isoWeekday, shortDay } from '../../../i18n/format';
import type { PlanSessionRef } from '../sheets/types';

/** A translator in the account language (`useT().t`). */
export type Translate = (key: string, params?: Params) => string;

/** "Today", "Yesterday", or the short day ("Wed 15 Oct"). */
export function dateLine(cardDate: string, today: string, t: Translate, lang: Lang): string {
  if (cardDate === today) return t('logworkout.date.today');
  if (addServerDays(today, -1) === cardDate) return t('logworkout.date.yesterday');
  return shortDay(cardDate, lang);
}

/**
 * "Was it Saturday's session? Do it today instead" / "Var þetta æfing
 * laugardagsins? ...". Icelandic needs the weekday in the genitive, so both
 * languages read their own small table (`logworkout.weekday_gen.<1-7>`,
 * Monday first) rather than a formatter. Null when the date is not a day.
 */
export function pullLine(scheduledFor: string, t: Translate): string | null {
  const weekday = isoWeekday(scheduledFor);
  if (weekday === null) return null;
  return t('logworkout.pull', { day: t(`logworkout.weekday_gen.${weekday}`) });
}

/**
 * The muted line on a row the watch or a door scan already counted, so the
 * same workout is not logged twice by hand. Only on a done row.
 */
export function alreadyLoggedKey(session: Pick<PlanSessionRef, 'status' | 'doneSource'>): string | null {
  if (session.status !== 'done') return null;
  switch (session.doneSource) {
    case 'wearable':
      return 'logworkout.already_watch';
    case 'check_in':
      return 'logworkout.already_visit';
    default:
      return null;
  }
}

/** Analytics `entry`: the row the workout was logged on. A fixed word. */
export function logWorkoutEntry(session: Pick<PlanSessionRef, 'status'>): 'done' | 'skipped' | 'missed' | 'rest' {
  switch (session.status) {
    case 'done':
      return 'done';
    case 'skipped':
      return 'skipped';
    case 'missed':
      return 'missed';
    default:
      return 'rest';
  }
}

/**
 * The pull line belongs on TODAY's rest day only: a past card cannot pull a
 * session into a day that is over (iOS `contextLines`).
 */
export function showsPullLine(
  session: Pick<PlanSessionRef, 'status' | 'kind'>,
  context: { readonly cardDate: string; readonly today: string },
): boolean {
  return context.cardDate === context.today && (session.status === 'rest' || session.kind === 'rest');
}

/** "min" / "mín" beside the minutes field: the chip's own word without a number. */
export function minutesSuffix(t: Translate): string {
  return t('logworkout.minutes_chip', { minutes: '' }).trim();
}
