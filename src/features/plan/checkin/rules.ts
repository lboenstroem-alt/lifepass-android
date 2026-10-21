/**
 * The weekly check-in sheet's decisions as pure functions (iOS
 * WeeklyCheckInSheet.swift: `prefill`, `weightValue`, `weightIsValid`,
 * `canSave`, `lastWeightLine`, `stepRating` and `checkInBody`), so the rules
 * that decide what is sent about a member's body are tested without a
 * screen.
 *
 * NOTHING IS MANDATORY. A weight alone, a rating alone, or a skipped weight
 * with a rating all save; only an empty sheet does not. A weight logged in
 * the last three days (from any source) is prefilled AND skipped, so nobody
 * is asked to stand on a scale twice in a week (`ios-ux.md` 9.3); the Log
 * weight mode of Body and goals is a weight only, and never pre-skips.
 *
 * TYPED NUMBERS are read with `parseDecimal` (F1's port of
 * HealthFormat.parseDecimal): "72,5" and "72.5" are both 72.5 whatever the
 * keyboard, and "7.2.5" is no number at all.
 */
import type { CheckInState, WeighInState } from '../../../health';
import type { Lang } from '../../../i18n';
import { formatDecimalInput } from '../../../components/ui/numberInput';
import { decimal, parseDecimal, parseInteger, shortDay } from '../../../i18n/format';

import type { HealthCheckInBody, WeekRating } from './api';

/**
 * iOS `BodyDetails.weightRange` and `heightRange`: the 30 to 300 kg and 120
 * to 230 cm every body field takes, the same numbers as the body sheet's
 * (BODY-2's `BODY_WEIGHT_RANGE` / `BODY_HEIGHT_RANGE`, which a test holds
 * these to). Written here so these rules load without the body sheet's UI.
 */
export const CHECKIN_WEIGHT_RANGE = { min: 30, max: 300 } as const;
export const CHECKIN_HEIGHT_RANGE = { min: 120, max: 230 } as const;

/** `weekly`: the check-in. `weightOnly`: Body and goals "Log weight", the weight field and nothing else. */
export type WeeklyCheckInMode = 'weekly' | 'weightOnly';

/** What the member has filled in (the sheet's @State). */
export interface CheckInForm {
  readonly weightText: string;
  readonly weightSkipped: boolean;
  readonly rating: WeekRating | null;
  readonly heightText: string;
  readonly heightConfirmed: boolean;
  readonly showHeightField: boolean;
}

/** A copy key and its values, resolved by the sheet in the account language. */
export interface CheckInLine {
  readonly key: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** The weight a step starts from when the field is empty or unreadable: the last weigh-in, else 70 kg. */
export function stepFallbackKg(weighIn: WeighInState | null): number {
  return weighIn?.lastWeightKg ?? 70;
}

/**
 * The form a presentation opens with (iOS `prefill`): a weight from the last
 * three days fills the field and, in the weekly mode, skips it; otherwise the
 * last weight fills it. Nothing else is chosen for the member.
 */
export function prefillCheckIn(
  mode: WeeklyCheckInMode,
  weighIn: WeighInState | null,
  checkIn: CheckInState | null,
  language: Lang,
): CheckInForm {
  const empty: CheckInForm = {
    weightText: '',
    weightSkipped: false,
    rating: null,
    heightText: '',
    heightConfirmed: false,
    showHeightField: false,
  };
  const recent = checkIn?.recentWeightKg ?? null;
  if (recent !== null) {
    return { ...empty, weightText: formatDecimalInput(recent, language), weightSkipped: mode === 'weekly' };
  }
  const last = weighIn?.lastWeightKg ?? null;
  if (last !== null) return { ...empty, weightText: formatDecimalInput(last, language) };
  return empty;
}

/** The weight being sent: none while skipped or unreadable. */
export function checkInWeight(form: Pick<CheckInForm, 'weightText' | 'weightSkipped'>): number | null {
  return form.weightSkipped ? null : parseDecimal(form.weightText);
}

/**
 * True when the field holds nothing to object to: skipped, empty, or a
 * weight between 30 and 300 kg. Anything typed that is not a weight in that
 * range shows "Enter a weight between 30 and 300 kg." and holds Save.
 */
export function weightIsValid(form: Pick<CheckInForm, 'weightText' | 'weightSkipped'>): boolean {
  if (form.weightSkipped) return true;
  const value = checkInWeight(form);
  if (value === null) return form.weightText === '';
  return value >= CHECKIN_WEIGHT_RANGE.min && value <= CHECKIN_WEIGHT_RANGE.max;
}

/** Save is live with a valid weight or a rating (Log weight: a valid weight only). */
export function canSaveCheckIn(form: CheckInForm, mode: WeeklyCheckInMode): boolean {
  if (!weightIsValid(form)) return false;
  if (mode === 'weightOnly') return checkInWeight(form) !== null;
  return checkInWeight(form) !== null || form.rating !== null;
}

/**
 * The height the "Still {cm} cm tall?" question asks about, or null when it
 * is not asked. Only in the weekly mode, only when the server says the
 * height is due a confirmation, and only while a weight is being sent: the
 * schema refuses a height without a weight, so a Yes tapped beside a skipped
 * weight would look answered, send nothing, and come back next week (C27).
 */
export function heightQuestionCm(
  mode: WeeklyCheckInMode,
  weighIn: WeighInState | null,
  form: Pick<CheckInForm, 'weightSkipped'>,
): number | null {
  if (mode !== 'weekly' || form.weightSkipped) return null;
  if (weighIn?.heightConfirmDue !== true) return null;
  return weighIn.heightCm ?? null;
}

/**
 * The OP-23 body (iOS `checkInBody`): the rating and the weight as filled
 * in, and with a weight, EITHER a changed height (120 to 230 cm, as typed
 * in the Change field) OR "still the same", never both. A Change field that
 * holds no height in range sends neither, as on iOS.
 */
export function checkInBody(form: CheckInForm): HealthCheckInBody {
  const weightKg = checkInWeight(form);
  const body: { weekRating?: WeekRating; weightKg?: number; heightCm?: number; heightConfirmed?: true } = {};
  if (form.rating !== null) body.weekRating = form.rating;
  if (weightKg === null) return body;
  body.weightKg = weightKg;
  const cm = form.showHeightField ? parseInteger(form.heightText) : null;
  if (cm !== null && cm >= CHECKIN_HEIGHT_RANGE.min && cm <= CHECKIN_HEIGHT_RANGE.max) {
    body.heightCm = cm;
  } else if (form.heightConfirmed) {
    body.heightConfirmed = true;
  }
  return body;
}

/** The ratings worst to best: a TalkBack swipe steps through them in this order. */
const RATING_STEPS: readonly WeekRating[] = ['tough', 'ok', 'great'];

/** One step through the week ratings, starting at OK when nothing is chosen yet (iOS `stepRating`). */
export function stepRating(current: WeekRating | null, delta: 1 | -1): WeekRating {
  const index = current === null ? 1 : RATING_STEPS.indexOf(current);
  const next = Math.min(Math.max(index + delta, 0), RATING_STEPS.length - 1);
  return RATING_STEPS[next]!;
}

/**
 * The line under the weight field (iOS `lastWeightLine`): "You logged a
 * weight recently..." while a recent weight is skipped, else the last weigh-in
 * and its day, else nothing. A weight synced from a wearable (the member's
 * Apple Health, through their iPhone) says so in neutral words on Android,
 * where no Health Connect is read (owner decision; the PLAN-5 pack).
 */
export function lastWeightLine(
  form: Pick<CheckInForm, 'weightSkipped'>,
  weighIn: WeighInState | null,
  checkIn: CheckInState | null,
  language: Lang,
): CheckInLine | null {
  if ((checkIn?.recentWeightKg ?? null) !== null && form.weightSkipped) return { key: 'checkin.recent_weight' };
  const last = weighIn?.lastWeightKg ?? null;
  const measured = weighIn?.lastMeasuredAt ?? null;
  if (last === null || measured === null) return null;
  const date = shortDay(measured, language);
  if (weighIn?.lastSource === 'wearable') return { key: 'checkin.from_health_app', params: { date } };
  return { key: 'checkin.last', params: { kg: decimal(last, language), date } };
}
