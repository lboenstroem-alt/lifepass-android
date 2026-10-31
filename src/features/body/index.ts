/**
 * The Body and goals feature's public door (plan 3.0, the feature-boundaries
 * rule). The screens are routes (`BodyAndGoals`, `Measurements`); the body
 * and target sheets are BODY-2's (./sheets).
 *
 * What other packages use from here: the reminder choices, written once.
 *
 * - NOTIF-1's reminder planner reads them (`loadReminderPreferences`, a
 *   missing key reads as its default) and installs its coalesced sync with
 *   `onReminderSyncRequested`: Body and goals asks for one on every change
 *   and after the permission prompt is answered.
 * - PLAN-4's proposal card writes the workout half and the permission answer
 *   at Start (`writeWorkoutReminderChoice`) and reads the stored choice
 *   back (`loadReminderPreferences`).
 * - Plan's adopted banner reads the refused flag (`reminderDeniedKey`).
 */
export {
  checkInDayKey,
  DAY_TIMES,
  DEFAULT_REMINDER_PREFERENCES,
  loadNotificationsDenied,
  loadReminderPreferences,
  MORNING_TIMES,
  onReminderSyncRequested,
  preferencesFromStored,
  reminderDeniedKey,
  ReminderDefaults,
  reminderTimeLabel,
  requestReminderSync,
  writeNotificationsDenied,
  writeReminderPreferences,
  writeWorkoutReminderChoice,
  type CheckInWeekday,
  type ReminderChangeKind,
  type ReminderPreferences,
} from './reminders/preferences';
