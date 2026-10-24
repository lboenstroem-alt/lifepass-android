/**
 * The Today card's words, as pure functions over a translator (iOS
 * `PlanCopy` and the copy inside `PlanTodayCard`, Views/Plan/PlanTodayCard.swift,
 * and `LogWorkoutCopy`'s extra line, Views/Plan/LogWorkoutSheet.swift).
 *
 * The block's dose line is `exerciseLine` in src/health/doseCopy.ts, the one
 * module the card, the preview sheet and the runner all read it from.
 */
import type {
  DailyNote,
  DayView,
  ExtraWorkoutView,
  Feeling,
  HealthDay,
  SessionView,
  SkipReason,
} from '../../../health';
import { extraWorkoutLabelKey } from '../../../health';
import { pluralKey, type Lang, type Params } from '../../../i18n';
import { duration, shortDay } from '../../../i18n/format';

/** A translator in the account language (`useT().t`). */
export type Translate = (key: string, params?: Params) => string;

/** The neutral line for a session a wearable counted (Android pack PLAN-2; iOS names Apple Health). */
export const DONE_SOURCE_WEARABLE_KEY = 'plan.done_source.wearable_android';

/**
 * The kicker over the card: "Today · week 2 of 4", or "Wed 17 Sept · week 2
 * of 4" for another day. A programme with no counter reads week 1 of 4.
 */
export function todayKicker(day: Pick<HealthDay, 'program' | 'date'>, isToday: boolean, t: Translate, lang: Lang): string {
  const week = `${day.program?.weekNo ?? 1}`;
  const weeks = `${day.program?.weeks ?? 4}`;
  if (isToday) return t('plan.today.kicker', { week, weeks });
  return t('plan.day.kicker', { date: shortDay(day.date, lang), week, weeks });
}

/** The session title, or "Rest day" when the date has none. */
export function todayTitle(session: Pick<SessionView, 'title'> | null, t: Translate): string {
  return session?.title ?? t('plan.today.rest_title');
}

/** "45 min · Moderate", or null for a rest day or a session with no minutes. */
export function metaLine(session: Pick<SessionView, 'kind' | 'minutes' | 'intensity'> | null, t: Translate): string | null {
  if (!session || (session.kind ?? 'rest') === 'rest') return null;
  const minutes = session.minutes;
  if (minutes === null || minutes <= 0) return null;
  return t('plan.today.meta', { minutes: `${minutes}`, intensity: intensityWord(session.intensity, t) });
}

/**
 * The preview's meta line (iOS `SessionPreviewSheet.metaLine`): "45 min ·
 * Moderate". A session with no length (a day the member wrote without one)
 * says only how hard it is, and a rest day says nothing: never "0 min" (the
 * fix iOS makes in the same release).
 */
export function previewMetaLine(session: Pick<SessionView, 'kind' | 'minutes' | 'intensity'>, t: Translate): string | null {
  // A rest day (or a kind this build does not know) says nothing.
  const kind = session.kind ?? 'rest';
  if (kind === 'rest' || kind === 'unknown') return null;
  const minutes = session.minutes;
  if (minutes === null || minutes <= 0) return intensityWord(session.intensity, t);
  return t('plan.today.meta', { minutes: `${minutes}`, intensity: intensityWord(session.intensity, t) });
}

/**
 * Easy, Moderate or Hard; none reads Moderate (iOS `intensity ?? .moderate`).
 * An intensity this build does not know reads Moderate too: iOS prints the
 * raw key `plan.intensity.unknown` there, and a key is never member copy.
 */
function intensityWord(intensity: SessionView['intensity'], t: Translate): string {
  const known = intensity === 'easy' || intensity === 'hard' ? intensity : 'moderate';
  return t(`plan.intensity.${known}`);
}

/** The recovery chip's band word: today only, and only a band the app knows. */
export function recoveryBandWord(day: Pick<HealthDay, 'scores'>, isToday: boolean, t: Translate): string | null {
  const band = day.scores?.recoveryBand;
  if (!isToday || !band || !['low', 'ok', 'high'].includes(band)) return null;
  return t(`ah.band.${band}`);
}

/** The note row is drawn when the note has something to say. */
export function noteHasContent(note: DailyNote | null | undefined): boolean {
  return !!note && ((note.title ?? '') !== '' || (note.body ?? '') !== '');
}

/**
 * The reasons behind the daily note (NoteWhySheet). A reason code the app
 * does not know yet prints nothing rather than its own key: the server may
 * ship a new rule before the app is updated.
 */
export function noteReasonLines(note: Pick<DailyNote, 'reasonCodes'> | null | undefined, t: Translate): string[] {
  return (note?.reasonCodes ?? []).flatMap((code) => {
    const key = `note.reason.${code}`;
    const value = t(key);
    return value === key ? [] : [value];
  });
}

/** "Easy · 2 h 30 min · 640 m up", or without the ascent for a flat walk. */
export function hikeLine(sight: NonNullable<DayView['attraction']>, t: Translate, lang: Lang): string {
  const difficulty = t(`plan.difficulty.${sight.difficulty ?? 'moderate'}`);
  const time = duration(sight.durationMinutes ?? 0, lang);
  if (sight.ascentM === null) return t('plan.hike.line_flat', { difficulty, duration: time });
  return t('plan.hike.line', { difficulty, duration: time, ascent: `${sight.ascentM}` });
}

/** The localised skip reason, `paused` included; anything unknown reads "something else". */
export function skipReasonWord(reason: SkipReason | null | undefined, t: Translate): string {
  if (!reason || reason === 'unknown') return t('plan.skip_reason.other');
  return t(`plan.skip_reason.${reason}`);
}

/** The feeling chip's word, or null for none. */
export function feelingWord(feeling: Feeling | null | undefined, t: Translate): string | null {
  if (!feeling || feeling === 'unknown') return null;
  return t(`plan.feeling.${feeling}`);
}

/**
 * Where a done session was counted from, or null when the member marked it.
 * A door scan names the venue; a wearable gets Android's neutral line (iOS
 * names Apple Health, which an Android phone never reads: owner decision).
 */
export function doneSourceLine(session: Pick<SessionView, 'doneSource' | 'checkInVenueName'>, t: Translate): string | null {
  switch (session.doneSource) {
    case 'check_in':
      return t('plan.done_source.check_in', { venue: session.checkInVenueName ?? '' });
    case 'wearable':
      return t(DONE_SOURCE_WEARABLE_KEY);
    default:
      return null;
  }
}

/** "and 2 more" under the first three exercises (Icelandic plural rule). */
export function moreExercisesLine(extra: number, t: Translate, lang: Lang): string {
  return t(pluralKey('plan.more_exercises', extra, lang), { count: extra });
}

// ---------------------------------------------------------------------------
// Extras (a workout the member logged by hand, API 0.34.0)

/**
 * The type word of an extra: the server's title, else the kind's own label,
 * and nothing at all for `other` or no kind (iOS `LogWorkoutCopy.typeWord`).
 */
export function extraTypeWord(extra: Pick<ExtraWorkoutView, 'title' | 'kind'>, t: Translate): string | null {
  const title = extra.title?.trim();
  if (title) return title;
  const kind = extra.kind;
  if (!kind || kind === 'other' || kind === 'unknown') return null;
  return t(extraWorkoutLabelKey(kind));
}

/** "Extra workout · Gym · 45 min", or "Extra workout · 45 min". */
export function extraLine(extra: Pick<ExtraWorkoutView, 'title' | 'kind' | 'minutes'>, t: Translate, lang: Lang): string {
  const parts = [t('history.workout.extra')];
  const type = extraTypeWord(extra, t);
  if (type) parts.push(type);
  parts.push(duration(extra.minutes ?? 0, lang));
  return parts.join(' · ');
}

/** "45 minutes" / "45 mínútur", for TalkBack. */
export function spokenMinutes(minutes: number, t: Translate, lang: Lang): string {
  return t(pluralKey('logworkout.minutes_a11y', minutes, lang), { minutes: `${minutes}` });
}

/** "Remove extra workout: Gym, 45 minutes". */
export function extraRemoveLabel(extra: Pick<ExtraWorkoutView, 'title' | 'kind' | 'minutes'>, t: Translate, lang: Lang): string {
  const minutes = spokenMinutes(extra.minutes ?? 0, t, lang);
  const type = extraTypeWord(extra, t);
  if (!type) return t('logworkout.remove_a11y_plain', { minutes });
  return t('logworkout.remove_a11y', { type, minutes });
}
