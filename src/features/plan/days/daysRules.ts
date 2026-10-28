/**
 * The change-days sheet's rules (iOS ChangeDaysSheet.swift), pure so they
 * can be tested on their own: which chips there are, what a tap does, when
 * Save is allowed, and what a refused save means.
 */
import type { ApiError } from '../../../api';

/**
 * ISO weekdays, Monday first. Four on the first row, three on the second,
 * which is what fits a 360 dp phone with 44 dp chips (iOS: 375 pt).
 */
export const DAY_ROWS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7],
];

/** A chip tap: on when it was off, off when it was on. The result is in weekday order. */
export function toggleDay(picked: readonly number[], weekday: number): number[] {
  const next = picked.includes(weekday) ? picked.filter((day) => day !== weekday) : [...picked, weekday];
  return [...new Set(next)].sort((a, b) => a - b);
}

/**
 * Save only with EXACTLY the plan's number of days. One picker, one rule
 * about how many days a plan needs, whichever caller opened it.
 */
export function isValidSelection(picked: readonly number[], daysPerWeek: number): boolean {
  return new Set(picked).size === daysPerWeek;
}

/** The days a sheet opens with: what the caller had, in range, in order. */
export function initialSelection(selected: readonly number[]): number[] {
  return [...new Set(selected.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
}

/**
 * What a refused save means (iOS `save()`'s catch):
 * - `changed`: the plan was ended, finished or deleted elsewhere; the sheet
 *   closes and the caller says so ("This was changed on another device").
 * - `offline`: no answer; the sheet stays with "This needs a connection."
 * - `other`: the sheet stays with "Something went wrong."
 */
export type DaysSaveFailure = 'changed' | 'offline' | 'other';

export function daysSaveFailure(error: unknown): DaysSaveFailure {
  const apiError = error as Partial<ApiError> | null;
  if (apiError && typeof apiError.isProblem === 'function') {
    if (apiError.isProblem('program_action_not_allowed', 'health_program_not_found')) return 'changed';
    if (apiError.isOffline === true) return 'offline';
  }
  return 'other';
}

/** The inline line a failure leaves on the sheet (none: the sheet closes). */
export function daysSaveErrorKey(failure: DaysSaveFailure): string | null {
  switch (failure) {
    case 'changed':
      return null;
    case 'offline':
      return 'health.offline.action_hint';
    case 'other':
      return 'common.error_body';
  }
}
