/**
 * "Change date" (iOS `MealDatePickerSheet`, ios-ux.md 12.3): a day from
 * today back 30 days in Photo mode (OP-32 takes no older), a year in
 * Barcode and Search.
 *
 * ANDROID: the system date dialog instead of a sheet with a graphical
 * picker and Done (plan 5.6). Its OK picks, Cancel or back leaves the date
 * as it was. The dialog runs on Iceland's calendar (`timeZoneName: 'UTC'`),
 * so a phone abroad shows and returns the same day the server files the meal
 * under. Month and weekday names follow the phone's language, as every
 * Android date dialog does.
 */
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { colors } from '../../../theme';
import { addServerDays, dateFromServerDay, serverDay, todayServerDay } from '../../../i18n/format';

import { PHOTO_PAST_DAYS, SEARCH_PAST_DAYS } from './captureModel';

/** The days a date can be picked from (inclusive), as server days. */
export function datePickerRange(allowsOlderThan30Days: boolean, today: string = todayServerDay()): { readonly first: string; readonly last: string } {
  const days = allowsOlderThan30Days ? SEARCH_PAST_DAYS : PHOTO_PAST_DAYS;
  return { first: addServerDays(today, -days) ?? today, last: today };
}

/** The picked day, kept inside the range (iOS `in: range`). */
export function clampDay(day: string, range: { readonly first: string; readonly last: string }): string {
  if (day < range.first) return range.first;
  if (day > range.last) return range.last;
  return day;
}

export interface MealDatePickerOptions {
  readonly date: string;
  readonly allowsOlderThan30Days: boolean;
  readonly doneLabel: string;
  readonly cancelLabel: string;
  readonly onPick: (day: string) => void;
}

/**
 * The library, loaded on first use: its module looks up the native date
 * picker the moment it is imported, which every screen that only imports the
 * meal page (the navigators, and their tests) would otherwise pay for.
 */
function datePickerModule(): typeof import('@react-native-community/datetimepicker') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-community/datetimepicker') as typeof import('@react-native-community/datetimepicker');
}

/** Opens the date dialog on `date`; `onPick` gets the chosen server day (not called on Cancel). */
export function openMealDatePicker(options: MealDatePickerOptions): void {
  const { DateTimePickerAndroid } = datePickerModule();
  const range = datePickerRange(options.allowsOlderThan30Days);
  const now = new Date();
  const value = dateFromServerDay(clampDay(options.date, range)) ?? now;
  DateTimePickerAndroid.open({
    mode: 'date',
    value: value.getTime() > now.getTime() ? now : value,
    minimumDate: dateFromServerDay(range.first) ?? undefined,
    maximumDate: now,
    timeZoneName: 'UTC',
    positiveButton: { label: options.doneLabel, textColor: colors.accentText },
    negativeButton: { label: options.cancelLabel, textColor: colors.accentText },
    onChange: (event: DateTimePickerEvent, picked?: Date) => {
      if (event.type !== 'set' || !picked) return;
      options.onPick(clampDay(serverDay(picked), range));
    },
  });
}
