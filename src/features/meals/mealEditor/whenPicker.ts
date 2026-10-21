/**
 * The meal editor's When row (iOS `MealDatePickerSheet(includesTime: true)`):
 * the day and the time the meal was eaten, from 30 days back for a new meal
 * or a draft (OP-32 and OP-56 take no older) or a year back for a meal
 * already in the diary, and never in the future.
 *
 * ANDROID: the system date dialog, then the time dialog, instead of one sheet
 * with a graphical calendar and Done (plan 5.6). Cancel or back on either
 * leaves the meal as it was. Both run on the phone's own clock, as the iOS
 * picker and the row's "Today, 12:40" do; the day the meal is filed under is
 * the server's day of that instant.
 */
import type { DateTimePickerAndroid as PickerApi, DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { colors } from '../../../theme';

/**
 * The system dialogs, loaded when the row is tapped: the library reaches for
 * its native module as it loads, and the editor's screens are imported with
 * the navigation at startup (and in every test that mounts it).
 */
function dialogs(): typeof PickerApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@react-native-community/datetimepicker') as { DateTimePickerAndroid: typeof PickerApi }).DateTimePickerAndroid;
}

/** How far back the picker reaches. */
export function whenRangeStart(allowsOlderThan30Days: boolean, now: Date = new Date()): Date {
  const days = allowsOlderThan30Days ? 365 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The picked day (phone calendar) at the picked time (phone clock). */
export function combineDayAndTime(day: Date, time: Date): Date {
  const combined = new Date(day.getTime());
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

/** `instant` kept inside the picker's range. */
export function clampToRange(instant: Date, start: Date, now: Date): Date {
  if (instant.getTime() < start.getTime()) return start;
  if (instant.getTime() > now.getTime()) return now;
  return instant;
}

export interface MealWhenPickerOptions {
  /** The meal's time now (the dialogs open on it). */
  readonly initial: Date;
  readonly allowsOlderThan30Days: boolean;
  readonly doneLabel: string;
  readonly cancelLabel: string;
  /** The picked instant, inside the range; not called on Cancel. */
  readonly onPick: (instant: Date) => void;
}

/** Opens the date dialog, then the time dialog. */
export function openMealWhenPicker(options: MealWhenPickerOptions): void {
  const now = new Date();
  const start = whenRangeStart(options.allowsOlderThan30Days, now);
  const initial = clampToRange(options.initial, start, now);
  const buttons = {
    positiveButton: { label: options.doneLabel, textColor: colors.accentText },
    negativeButton: { label: options.cancelLabel, textColor: colors.accentText },
  };
  const picker = dialogs();
  picker.open({
    ...buttons,
    mode: 'date',
    value: initial,
    minimumDate: start,
    maximumDate: now,
    onChange: (event: DateTimePickerEvent, day?: Date) => {
      if (event.type !== 'set' || !day) return;
      picker.open({
        ...buttons,
        mode: 'time',
        is24Hour: true,
        value: combineDayAndTime(day, initial),
        onChange: (timeEvent: DateTimePickerEvent, time?: Date) => {
          if (timeEvent.type !== 'set' || !time) return;
          options.onPick(clampToRange(combineDayAndTime(day, time), start, new Date()));
        },
      });
    },
  });
}
