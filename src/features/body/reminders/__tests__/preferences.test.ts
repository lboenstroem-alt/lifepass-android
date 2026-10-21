/**
 * The reminder choices (iOS `HealthReminderPreferences` and Body and goals'
 * load and write): the defaults, a missing or unreadable key read as its
 * default, every key written on a change and never on a read, the resync
 * request, and the names PLAN-1's adopted banner and the health wipe use.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ReminderKeys } from '../../../../health';
import * as analytics from '../../../../lib/analytics';
import { reminderDeniedKey as planBannerDeniedKey } from '../../../plan/shell';
import {
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
  resetReminderSyncListenersForTests,
  writeNotificationsDenied,
  writeReminderPreferences,
  writeWorkoutReminderChoice,
} from '../preferences';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

const nothingStored = { workoutDay: null, time: null, weeklyCheckIn: null, checkInDay: null, checkInTime: null };

beforeEach(() => {
  resetReminderSyncListenersForTests();
});

describe('the defaults (HealthReminderPlannerTests, Body and goals ReminderDefaults)', () => {
  it('testTheDefaultWorkoutTimeIsSevenInTheMorning', () => {
    expect(ReminderDefaults.workoutTimeMinutes).toBe(7 * 60);
    expect(DEFAULT_REMINDER_PREFERENCES.workoutTimeMinutes).toBe(7 * 60);
  });

  it('a member who never touched a reminder has both on, 07:00 and Monday 07:30', () => {
    expect(preferencesFromStored(nothingStored)).toEqual({
      workoutNotesOn: true,
      workoutTimeMinutes: 420,
      checkInOn: true,
      checkInWeekday: 1,
      checkInTimeMinutes: 450,
    });
  });

  it('nothing stored reads as the defaults from storage too', async () => {
    await expect(loadReminderPreferences(MEMBER)).resolves.toEqual(DEFAULT_REMINDER_PREFERENCES);
  });

  it('a missing key is its default, whatever the others say (after a wipe the rows show the defaults)', () => {
    expect(preferencesFromStored({ ...nothingStored, weeklyCheckIn: 'false' })).toEqual({
      ...DEFAULT_REMINDER_PREFERENCES,
      checkInOn: false,
    });
  });

  it('reads what iOS UserDefaults would: flags as true/1/yes, a time only after midnight, Monday or Sunday only', () => {
    expect(
      preferencesFromStored({ workoutDay: 'false', time: '390', weeklyCheckIn: '1', checkInDay: '7', checkInTime: '1140' }),
    ).toEqual({ workoutNotesOn: false, workoutTimeMinutes: 390, checkInOn: true, checkInWeekday: 7, checkInTimeMinutes: 1140 });
    expect(
      preferencesFromStored({ workoutDay: 'yes', time: '0', weeklyCheckIn: 'nope', checkInDay: '3', checkInTime: 'later' }),
    ).toEqual({ workoutNotesOn: true, workoutTimeMinutes: 420, checkInOn: false, checkInWeekday: 1, checkInTimeMinutes: 450 });
  });

  it('storage that cannot be read gives the defaults', async () => {
    jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('disk'));
    await expect(loadReminderPreferences(MEMBER)).resolves.toEqual(DEFAULT_REMINDER_PREFERENCES);
  });
});

describe('writing', () => {
  it('a change writes all five keys under iOS names, reports which, and asks for one resync', async () => {
    const track = jest.spyOn(analytics, 'track');
    const sync = jest.fn();
    onReminderSyncRequested(sync);

    await writeReminderPreferences(
      MEMBER,
      { workoutNotesOn: false, workoutTimeMinutes: 390, checkInOn: true, checkInWeekday: 7, checkInTimeMinutes: 1140 },
      'time',
    );

    const stored = Object.fromEntries(await AsyncStorage.multiGet(ReminderKeys.all(MEMBER)));
    expect(stored).toEqual({
      [`health.reminders.${MEMBER}.workoutday`]: 'false',
      [`health.reminders.${MEMBER}.time`]: '390',
      [`health.reminders.${MEMBER}.weeklycheckin`]: 'true',
      [`health.reminders.${MEMBER}.checkinDay`]: '7',
      [`health.reminders.${MEMBER}.checkinTime`]: '1140',
    });
    expect(track).toHaveBeenCalledWith('reminder_setting_changed', { kind: 'time' });
    expect(sync).toHaveBeenCalledTimes(1);
    await expect(loadReminderPreferences(MEMBER)).resolves.toEqual({
      workoutNotesOn: false,
      workoutTimeMinutes: 390,
      checkInOn: true,
      checkInWeekday: 7,
      checkInTimeMinutes: 1140,
    });
  });

  it('reading never writes and never reports', async () => {
    const track = jest.spyOn(analytics, 'track');
    const setItems = jest.spyOn(AsyncStorage, 'multiSet');
    const sync = jest.fn();
    onReminderSyncRequested(sync);
    await loadReminderPreferences(MEMBER);
    expect(setItems).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('a listener that throws never stops the others; an unsubscribed one is not called', async () => {
    const broken = jest.fn(() => {
      throw new Error('planner');
    });
    const later = jest.fn();
    const gone = jest.fn();
    onReminderSyncRequested(broken);
    onReminderSyncRequested(later);
    onReminderSyncRequested(gone)();
    await writeReminderPreferences(MEMBER, DEFAULT_REMINDER_PREFERENCES, 'workoutday');
    expect(broken).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();
  });

  it("the proposal card's half: the switch, the time and the permission answer, the check-in left alone", async () => {
    await AsyncStorage.setItem(ReminderKeys.weeklyCheckIn(MEMBER), 'false');
    await writeWorkoutReminderChoice(MEMBER, { workoutNotesOn: true, workoutTimeMinutes: 480, notificationsDenied: true });
    await expect(loadReminderPreferences(MEMBER)).resolves.toMatchObject({
      workoutNotesOn: true,
      workoutTimeMinutes: 480,
      checkInOn: false,
    });
    await expect(loadNotificationsDenied(MEMBER)).resolves.toBe(true);
  });

  it('the refused flag is the one name Plan reads, and the health wipe leaves it (as iOS does)', async () => {
    expect(reminderDeniedKey(MEMBER)).toBe(`health.reminders.${MEMBER}.denied`);
    expect(reminderDeniedKey(MEMBER)).toBe(planBannerDeniedKey(MEMBER));
    expect(ReminderKeys.all(MEMBER)).not.toContain(reminderDeniedKey(MEMBER));
    await expect(loadNotificationsDenied(MEMBER)).resolves.toBe(false);
    await writeNotificationsDenied(MEMBER, true);
    await expect(loadNotificationsDenied(MEMBER)).resolves.toBe(true);
    await writeNotificationsDenied(MEMBER, false);
    await expect(loadNotificationsDenied(MEMBER)).resolves.toBe(false);
  });
});

describe('the menus and their words', () => {
  it('the workout note offers 06:00 to 10:00 and the check-in 06:00 to 21:00, by half hours', () => {
    expect(MORNING_TIMES.map(reminderTimeLabel)).toEqual([
      '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00',
    ]);
    expect(DAY_TIMES[0]).toBe(360);
    expect(DAY_TIMES[DAY_TIMES.length - 1]).toBe(21 * 60);
    expect(DAY_TIMES).toHaveLength(31);
    expect(DAY_TIMES.every((minutes, index) => index === 0 || minutes - DAY_TIMES[index - 1]! === 30)).toBe(true);
  });

  it('a time is a wall-clock 24-hour time, whatever zone the phone is in (iOS drew 07:00 as 06:43 once)', () => {
    expect(reminderTimeLabel(420)).toBe('07:00');
    expect(reminderTimeLabel(450)).toBe('07:30');
    expect(reminderTimeLabel(1260)).toBe('21:00');
  });

  it('Mondays or Sundays', () => {
    expect(checkInDayKey(1)).toBe('bodygoals.day.monday');
    expect(checkInDayKey(7)).toBe('bodygoals.day.sunday');
  });
});
