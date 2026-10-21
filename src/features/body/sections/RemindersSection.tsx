/**
 * 5. Reminders, with consent only (iOS `remindersSection`):
 *
 * - "Notifications are off for LifePass." and Open Settings, when the phone
 *   refuses them; every row below is then off;
 * - Workout day notes, on or off, and their Time (06:00 to 10:00, by half
 *   hours; off while the notes are);
 * - Weekly check-in, "Mondays at 07:30", and its Day and time (Mondays or
 *   Sundays, 06:00 to 21:00; off while the check-in is).
 *
 * Defaults: on at 07:00, on Mondays at 07:30. Switching a reminder ON asks
 * for the permission only if it was never asked. Every change is stored per
 * member and the reminders are rescheduled at once (../reminders).
 */
import type { MenuOption } from '../../../components/ui';
import { useT } from '../../../i18n';
import { openNotificationSettings } from '../../../notifications';
import { AccountSection } from '../../account';

import {
  checkInDayKey,
  DAY_TIMES,
  MORNING_TIMES,
  reminderTimeLabel,
  type CheckInWeekday,
} from '../reminders/preferences';
import type { ReminderSettings } from '../reminders/useReminderSettings';
import { CardMenuRow, CardMessageRow, CardToggleRow, RowMenu } from '../ui/parts';

function timeOptions(times: readonly number[], testID: string): MenuOption<string>[] {
  return times.map((minutes) => ({ value: String(minutes), label: reminderTimeLabel(minutes), testID: `${testID}.${minutes}` }));
}

export default function RemindersSection({ settings }: { readonly settings: ReminderSettings }) {
  const { t } = useT();
  const { preferences: prefs, notificationsDenied: denied, change } = settings;
  const dayOptions: MenuOption<string>[] = ([1, 7] as const).map((day: CheckInWeekday) => ({
    value: String(day),
    label: t(checkInDayKey(day)),
    testID: `bodygoals.rem.day.${day}`,
  }));
  const checkInWhenOn = prefs.checkInOn && !denied;

  return (
    <AccountSection kicker={t('bodygoals.sec.reminders')} testID="bodygoals.reminders">
      {denied ? (
        <CardMessageRow
          message={t('bodygoals.rem_denied')}
          actionLabel={t('bodygoals.open_settings')}
          onAction={() => void openNotificationSettings()}
          testID="bodygoals.rem.denied"
        />
      ) : null}

      <CardToggleRow
        title={t('bodygoals.rem_workout')}
        subtitle={t('bodygoals.rem_workout_sub')}
        value={prefs.workoutNotesOn}
        enabled={!denied}
        onChange={(on) => change({ workoutNotesOn: on }, 'workoutday', on)}
        testID="bodygoals.rem.workout"
      />

      <CardMenuRow title={t('bodygoals.rem_time')} enabled={prefs.workoutNotesOn && !denied} testID="bodygoals.rem.timeRow">
        <RowMenu
          label={t('bodygoals.rem_time')}
          options={timeOptions(MORNING_TIMES, 'bodygoals.rem.time')}
          value={String(prefs.workoutTimeMinutes)}
          valueLabel={reminderTimeLabel(prefs.workoutTimeMinutes)}
          onChange={(value) => change({ workoutTimeMinutes: Number(value) }, 'time')}
          enabled={prefs.workoutNotesOn && !denied}
          testID="bodygoals.rem.time"
        />
      </CardMenuRow>

      <CardToggleRow
        title={t('bodygoals.rem_checkin')}
        subtitle={t('bodygoals.rem_checkin_sub', {
          day: t(checkInDayKey(prefs.checkInWeekday)),
          time: reminderTimeLabel(prefs.checkInTimeMinutes),
        })}
        value={prefs.checkInOn}
        enabled={!denied}
        onChange={(on) => change({ checkInOn: on }, 'weeklycheckin', on)}
        testID="bodygoals.rem.checkin"
      />

      <CardMenuRow title={t('bodygoals.rem_checkin_when')} enabled={checkInWhenOn} testID="bodygoals.rem.whenRow">
        <RowMenu
          label={t('bodygoals.rem_checkin_when')}
          options={dayOptions}
          value={String(prefs.checkInWeekday)}
          onChange={(value) => change({ checkInWeekday: value === '7' ? 7 : 1 }, 'weeklycheckin')}
          enabled={checkInWhenOn}
          testID="bodygoals.rem.day"
        />
        <RowMenu
          label={t('bodygoals.rem_time')}
          options={timeOptions(DAY_TIMES, 'bodygoals.rem.checkinTime')}
          value={String(prefs.checkInTimeMinutes)}
          valueLabel={reminderTimeLabel(prefs.checkInTimeMinutes)}
          onChange={(value) => change({ checkInTimeMinutes: Number(value) }, 'weeklycheckin')}
          enabled={checkInWhenOn}
          testID="bodygoals.rem.checkinTime"
        />
      </CardMenuRow>
    </AccountSection>
  );
}
