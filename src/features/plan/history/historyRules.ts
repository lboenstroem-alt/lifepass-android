/**
 * What the history says (iOS PlanHistory.swift), pure so it can be tested
 * on its own: the ISO-week grouping, a set's line, a workout's lines, and a
 * past plan's status word.
 *
 * NO TIME SHIFTING. Grouping is done on the server's `YYYY-MM-DD` strings
 * (Iceland time = UTC): shifting them into the phone's time zone is how a
 * Sunday session lands in the previous week.
 */
import type { PerformedSet, ProgramSummary, SessionHistoryItem } from '../../../health';
import { addServerDays, decimal, duration, isoWeekday, shortDay } from '../../../i18n/format';
import type { Lang, Params } from '../../../i18n';
import { feelingWord, sessionStatusWord } from '../overview/planCopy';

export type Translate = (key: string, params?: Params) => string;

// ---------------------------------------------------------------------------
// Weeks

export interface WeekGroup {
  /** The Monday of the week, `YYYY-MM-DD`. */
  readonly week: string;
  readonly items: readonly SessionHistoryItem[];
}

/** The Monday of a server day's ISO week, or null when it is not a day. */
export function isoMonday(day: string): string | null {
  const weekday = isoWeekday(day);
  if (weekday === null) return null;
  return addServerDays(day, -(weekday - 1));
}

/**
 * The workouts grouped by the Monday of their own week, in the order the
 * server sent them (newest first); a workout with no readable date is left
 * out, as on iOS.
 */
export function weekGroups(items: readonly SessionHistoryItem[]): WeekGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, SessionHistoryItem[]>();
  for (const item of items) {
    const monday = item.date ? isoMonday(item.date) : null;
    if (!monday) continue;
    const bucket = buckets.get(monday);
    if (bucket) bucket.push(item);
    else {
      order.push(monday);
      buckets.set(monday, [item]);
    }
  }
  return order.map((week) => ({ week, items: buckets.get(week) ?? [] }));
}

// ---------------------------------------------------------------------------
// A set

/**
 * One set, in the unit it was done in (iOS `WorkoutDetailView.setLine`):
 * metres for a pool set, minutes for a whole-minute hold or stretch,
 * seconds, or reps with the weight. A set with no dose at all says which set
 * it was, never "0 reps".
 */
export function setLine(set: Pick<PerformedSet, 'meters' | 'seconds' | 'reps' | 'kg'>, number: number, t: Translate, lang: Lang): string {
  const n = String(number);
  if (set.meters !== null && set.meters > 0) {
    return t('history.detail.sets_meters', { n, meters: String(set.meters) });
  }
  if (set.seconds !== null && set.seconds > 0) {
    if (set.seconds >= 60 && set.seconds % 60 === 0) {
      return t('history.detail.sets_minutes', { n, minutes: String(set.seconds / 60) });
    }
    return t('history.detail.sets_timed', { n, seconds: String(set.seconds) });
  }
  const weight = set.kg !== null ? t('history.detail.weight_suffix', { kg: decimal(set.kg, lang) }) : '';
  if (set.reps === null || set.reps <= 0) return t('history.detail.sets_plain', { n }) + weight;
  return t('history.detail.sets', { n, reps: String(set.reps), weight });
}

// ---------------------------------------------------------------------------
// A workout

/**
 * "Extra workout" over the title, for an extra, unless the server already
 * titled it so (an extra on a rest day whose kind was "Other"): one says it.
 */
export function showsExtraKicker(item: Pick<SessionHistoryItem, 'isExtra' | 'title'>, t: Translate): boolean {
  return item.isExtra === true && item.title !== t('history.workout.extra');
}

/** The list row's meta: "40 min · felt Just right", or the length alone without a feeling. */
export function workoutMetaLine(item: Pick<SessionHistoryItem, 'minutes' | 'feeling'>, t: Translate, lang: Lang): string {
  const minutes = item.minutes ?? 0;
  const feeling = feelingWord(item.feeling, t);
  if (!feeling) return duration(minutes, lang);
  return t('history.workout.meta', { minutes: String(minutes), feeling });
}

/** The detail's meta: the day, the length when there is one, the feeling, joined by " · ". */
export function detailMetaLine(item: Pick<SessionHistoryItem, 'date' | 'minutes' | 'feeling'>, t: Translate, lang: Lang): string {
  const parts = [item.date ? shortDay(item.date, lang) : ''];
  if (item.minutes !== null && item.minutes > 0) parts.push(duration(item.minutes, lang));
  const feeling = feelingWord(item.feeling, t);
  if (feeling) parts.push(feeling);
  return parts.filter((part) => part.length > 0).join(' · ');
}

/**
 * Where the workout was counted from: a check-in at a venue, or a synced
 * workout (iOS names Apple Health; Android does not, owner decision: the
 * PLAN-4 pack's neutral line). Nothing for a workout the member logged.
 */
export function sourceLine(item: Pick<SessionHistoryItem, 'doneSource' | 'checkInVenueName'>, t: Translate): string | null {
  switch (item.doneSource) {
    case 'check_in':
      return t('plan.done_source.check_in', { venue: item.checkInVenueName ?? '' });
    case 'wearable':
      return t('plan4.done_source.synced');
    default:
      return null;
  }
}

/** One TalkBack element per row: the day, "Extra workout", the title, the meta, the status word. */
export function workoutRowLabel(item: SessionHistoryItem, t: Translate, lang: Lang): string {
  const parts = [
    item.date ? shortDay(item.date, lang) : '',
    showsExtraKicker(item, t) ? t('history.workout.extra') : '',
    item.title ?? '',
    workoutMetaLine(item, t, lang),
  ];
  const word = sessionStatusWord(item.status, t);
  if (word) parts.push(word);
  return parts.filter((part) => part.length > 0).join(', ');
}

// ---------------------------------------------------------------------------
// A past plan

/**
 * Not started, Updated, Completed or Ended early. A plan ended because the
 * member switched to an updated version of it reads "Updated", not "Ended
 * early", which would read as giving up.
 */
export function planStatusKey(plan: Pick<ProgramSummary, 'notStarted' | 'revised' | 'status'>): string {
  if (plan.notStarted === true) return 'history.plan.not_started';
  if (plan.revised === true) return 'history.plan.revised';
  return plan.status === 'completed' ? 'history.plan.completed' : 'history.plan.ended';
}

// ---------------------------------------------------------------------------
// The card on Plan

/**
 * What the History card on Plan shows, or null when there is nothing (no
 * workouts and no day with a logged meal): the latest workout's day and the
 * count of logged meal days.
 */
export function historyCardContent(
  history: { readonly workouts: readonly SessionHistoryItem[] | null; readonly mealDays: readonly { readonly mealCount: number | null }[] | null } | null,
): { readonly latestWorkoutDate: string | null; readonly loggedDays: number } | null {
  const workouts = history?.workouts ?? [];
  const loggedDays = (history?.mealDays ?? []).filter((day) => (day.mealCount ?? 0) > 0).length;
  if (workouts.length === 0 && loggedDays === 0) return null;
  return { latestWorkoutDate: workouts[0]?.date ?? null, loggedDays };
}
