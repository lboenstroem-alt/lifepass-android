/**
 * The pure reminder planner of `ios-ux.md` 19.2 (iOS
 * HealthReminderPlannerTests, all twenty cases, same vectors): what should be
 * pending, for which dates, at what time and with which words, from the store
 * alone. Then a few Android cases the port has to hold on its own.
 *
 * The dates are built on the PHONE's calendar (`new Date(y, m, d, h, min)`),
 * as iOS builds them on a Reykjavik calendar, so the suite reads the same in
 * UTC, New York and Tokyo (scripts/ci.sh runs all three).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import { DEFAULT_REMINDER_PREFERENCES, loadReminderPreferences, ReminderDefaults } from '../../features/body';
import type { DailyNote, SessionBrief, SessionKind, SessionStatusView } from '../../health';
import {
  bodyKeyFor,
  CHECK_IN_IDENTIFIER,
  desiredReminders,
  fireComponents,
  fireDate,
  isPlannerIdentifier,
  paramsFor,
  reviewWeek,
  weeklyCheckInFire,
  WORKOUT_PREFIX,
  type PlannedReminder,
  type PlannerPreferences,
  type TomorrowRead,
} from '../healthReminderPlanner';
import { notificationFor } from '../healthReminders';
import { scheduleAt } from '../scheduler';

/** 2026-09-18 is a Friday, 2026-09-21 the Monday after it. A wall-clock time on the phone. */
function at(day: string, hour: number, minute = 0, second = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute, second);
}

function row(
  date: string,
  kind: SessionKind,
  options: { title?: string | null; minutes?: number; status?: SessionStatusView } = {},
): SessionBrief {
  return {
    id: `s-${date}`,
    programId: 'prog-1',
    weekNo: 2,
    weekday: null,
    scheduledFor: date,
    kind,
    title: options.title === undefined ? 'Full body strength' : options.title,
    minutes: options.minutes ?? 40,
    intensity: 'moderate',
    status: options.status ?? 'planned',
    doneSource: null,
    feeling: null,
    skipReason: null,
    extrasCount: 0,
  };
}

function note(date: string, key: string | null): DailyNote {
  return {
    date,
    templateId: 't',
    title: 'A lighter day',
    body: 'You slept 5 h 12 min.',
    reasonCodes: ['short_sleep'],
    notificationKey: key,
  };
}

const DEFAULTS: PlannerPreferences = DEFAULT_REMINDER_PREFERENCES;

function plan(options: {
  upcoming: SessionBrief[];
  todayNote?: DailyNote | null;
  tomorrow?: TomorrowRead | null;
  review?: string | null;
  programActive?: boolean;
  eligible?: boolean;
  prefs?: PlannerPreferences;
  now: Date;
}): PlannedReminder[] {
  return desiredReminders({
    upcoming: options.upcoming,
    todayNote: options.todayNote ?? null,
    tomorrow: options.tomorrow ?? null,
    latestReviewWeekStartsOn: options.review ?? null,
    programActive: options.programActive ?? true,
    eligible: options.eligible ?? true,
    preferences: options.prefs ?? DEFAULTS,
    now: options.now,
  });
}

const fire = (year: number, month: number, day: number, hour: number, minute: number) => ({ year, month, day, hour, minute });

/** Only the clock is faked (the scheduler's fake compares with it); promises and timers run for real. */
function fakeClockOnly(now: Date): void {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('workout day notes', () => {
  /** 5.3's walk-through: a Friday evening open leaves next Monday's note pending. */
  it('testAFridayOpenSchedulesNextMondaysSession', () => {
    const upcoming = [
      row('2026-09-18', 'strength', { status: 'done' }),
      row('2026-09-19', 'hike', { title: 'Esja, then a soak', minutes: 90 }),
      row('2026-09-20', 'rest', { title: null, minutes: 0, status: 'rest' }),
      row('2026-09-21', 'strength'),
    ];
    const desired = plan({ upcoming, now: at('2026-09-18', 19) });
    const workout = desired.filter((reminder) => reminder.kind === 'workoutDay');
    expect(workout.map((reminder) => reminder.identifier)).toEqual([
      'health.workoutday.2026-09-19',
      'health.workoutday.2026-09-21',
    ]);

    const monday = workout[1]!;
    expect(monday.fire).toEqual(fire(2026, 9, 21, 7, 0));
    expect(monday.titleKey).toBe('notif.health.workout.title');
    expect(monday.bodyKey).toBe('notif.health.workout.body');
    expect(monday.params).toEqual({ title: 'Full body strength', minutes: '40' });
    expect(monday.route).toBe('plan');
    expect(workout[0]!.bodyKey).toBe('notif.health.outdoor.body');
  });

  it('testTheBodyFollowsTheKind', () => {
    expect(bodyKeyFor('strength')).toBe('notif.health.workout.body');
    expect(bodyKeyFor('cardio')).toBe('notif.health.workout.body');
    expect(bodyKeyFor('mobility')).toBe('notif.health.workout.body');
    expect(bodyKeyFor('class')).toBe('notif.health.class.body');
    expect(bodyKeyFor('swim')).toBe('notif.health.swim.body');
    expect(bodyKeyFor('hike')).toBe('notif.health.outdoor.body');
    expect(bodyKeyFor('walk')).toBe('notif.health.outdoor.body');
  });

  it('testAPausedPlanHasNoWorkoutNotes', () => {
    const desired = plan({ upcoming: [row('2026-09-21', 'strength')], programActive: false, now: at('2026-09-18', 19) });
    expect(desired.filter((reminder) => reminder.kind !== 'weeklyCheckIn')).toEqual([]);
  });

  it('testTodayDoneOrSkippedHasNoNote', () => {
    const upcoming = [
      row('2026-09-18', 'strength', { status: 'done' }),
      row('2026-09-19', 'swim', { title: 'Easy swim', minutes: 30, status: 'skipped' }),
    ];
    expect(plan({ upcoming, now: at('2026-09-18', 6) }).filter((reminder) => reminder.kind === 'workoutDay')).toEqual([]);
  });

  /** Today only if the time is at least 60 seconds away. */
  it('testTheSixtySecondRule', () => {
    const today = [row('2026-09-18', 'strength')];
    const workouts = (now: Date) => plan({ upcoming: today, now }).filter((reminder) => reminder.kind === 'workoutDay').length;
    expect(workouts(at('2026-09-18', 6, 58))).toBe(1);
    expect(workouts(new Date(at('2026-09-18', 7).getTime() - 30_000))).toBe(0);
    expect(workouts(at('2026-09-18', 7, 1))).toBe(0);
    // Exactly a minute away still counts (iOS `>= 60`).
    expect(workouts(at('2026-09-18', 6, 59))).toBe(1);
  });

  it('testTheMembersTimeIsUsed', () => {
    const prefs = { ...DEFAULTS, workoutTimeMinutes: 6 * 60 + 30 };
    const desired = plan({ upcoming: [row('2026-09-21', 'strength')], prefs, now: at('2026-09-18', 19) });
    expect(desired[0]?.fire.hour).toBe(6);
    expect(desired[0]?.fire.minute).toBe(30);
  });

  it('testTheDefaultWorkoutTimeIsSevenInTheMorning', () => {
    expect(DEFAULT_REMINDER_PREFERENCES.workoutTimeMinutes).toBe(7 * 60);
    expect(ReminderDefaults.workoutTimeMinutes).toBe(7 * 60);
  });

  it('testWorkoutNotesSwitchedOffScheduleNothingButTheCheckIn', () => {
    const prefs = { ...DEFAULTS, workoutNotesOn: false };
    const desired = plan({ upcoming: [row('2026-09-21', 'strength')], prefs, now: at('2026-09-18', 19) });
    expect(desired.map((reminder) => reminder.kind)).toEqual(['weeklyCheckIn']);
  });

  it('testWithoutConsentOrMembershipNothingIsPending', () => {
    expect(plan({ upcoming: [row('2026-09-21', 'strength')], eligible: false, now: at('2026-09-18', 19) })).toEqual([]);
  });

  /** A note variant replaces the generic body, and never carries a number. */
  it('testTodaysNoteVariantReplacesTheBody', () => {
    const desired = plan({
      upcoming: [row('2026-09-18', 'strength')],
      todayNote: note('2026-09-18', 'lighter'),
      now: at('2026-09-18', 6),
    });
    const today = desired.find((reminder) => reminder.identifier === 'health.workoutday.2026-09-18');
    expect(today?.bodyKey).toBe('notif.health.note.lighter');
    // The lock screen never carries the note's own words or numbers.
    expect(today?.params).toEqual({});
  });

  it('testAnUnknownNoteKeyKeepsTheGenericBody', () => {
    const desired = plan({
      upcoming: [row('2026-09-18', 'strength')],
      todayNote: note('2026-09-18', 'something_new'),
      now: at('2026-09-18', 6),
    });
    expect(desired[0]?.bodyKey).toBe('notif.health.workout.body');
  });
});

describe('rest picks (19.4)', () => {
  /** A Sunday after 20:30: the evening read of tomorrow found a rest day with a pick. */
  it('testARestPickFromTheEveningRead', () => {
    const desired = plan({
      upcoming: [row('2026-09-20', 'strength', { status: 'done' })],
      tomorrow: { date: '2026-09-21', isRest: true, notificationKey: 'rest_pick' },
      now: at('2026-09-20', 20, 45),
    });
    const rest = desired.find((reminder) => reminder.kind === 'restPick');
    expect(rest?.identifier).toBe('health.workoutday.2026-09-21');
    expect(rest?.bodyKey).toBe('notif.health.rest_pick.body');
    expect(rest?.fire).toEqual(fire(2026, 9, 21, 7, 0));
  });

  it('testARestDayWithoutAPickHasNoNote', () => {
    const desired = plan({
      upcoming: [],
      tomorrow: { date: '2026-09-21', isRest: true, notificationKey: null },
      now: at('2026-09-20', 20, 45),
    });
    expect(desired.filter((reminder) => reminder.kind !== 'weeklyCheckIn')).toEqual([]);
  });
});

describe('the weekly check-in', () => {
  /** On a Monday before the review is saved, it fires that morning about the week that ended the day before. */
  it('testMondayBeforeTheReview', () => {
    const desired = plan({ upcoming: [], review: '2026-09-07', now: at('2026-09-21', 6) });
    const checkIn = desired.find((reminder) => reminder.kind === 'weeklyCheckIn');
    expect(checkIn?.identifier).toBe('health.weeklycheckin');
    expect(checkIn?.fire).toEqual(fire(2026, 9, 21, 7, 30));
    expect(checkIn?.route).toBe('plan.checkin');
    expect(checkIn?.titleKey).toBe('notif.health.checkin.title');
  });

  /** The review for the week of 14 September is saved: the next one is the Monday after. */
  it('testMondayAfterTheReviewMovesToNextWeek', () => {
    const desired = plan({ upcoming: [], review: '2026-09-14', now: at('2026-09-21', 6) });
    expect(desired.find((reminder) => reminder.kind === 'weeklyCheckIn')?.fire).toEqual(fire(2026, 9, 28, 7, 30));
  });

  /** A member who picked Sunday is asked about the week ending that day. */
  it('testSundayAsksAboutTheWeekEndingThatDay', () => {
    const prefs = { ...DEFAULTS, checkInWeekday: 7 as const, checkInTimeMinutes: 19 * 60 };
    const before = plan({ upcoming: [], prefs, now: at('2026-09-18', 12) });
    expect(before.find((reminder) => reminder.kind === 'weeklyCheckIn')?.fire).toEqual(fire(2026, 9, 20, 19, 0));
    const reviewed = plan({ upcoming: [], review: '2026-09-14', prefs, now: at('2026-09-18', 12) });
    expect(reviewed.find((reminder) => reminder.kind === 'weeklyCheckIn')?.fire).toEqual(fire(2026, 9, 27, 19, 0));
  });

  it('testTheReviewWeekRule', () => {
    expect(reviewWeek(at('2026-09-21', 7, 30))).toBe('2026-09-14');
    expect(reviewWeek(at('2026-09-20', 19))).toBe('2026-09-14');
  });

  it('testTheCheckInSwitchedOffIsNotScheduled', () => {
    const prefs = { ...DEFAULTS, checkInOn: false };
    expect(plan({ upcoming: [], prefs, now: at('2026-09-18', 12) })).toEqual([]);
  });
});

describe('preferences', () => {
  it('testMissingPreferencesReadAsTheDefaults', async () => {
    await expect(loadReminderPreferences('p')).resolves.toEqual(DEFAULT_REMINDER_PREFERENCES);
    await AsyncStorage.multiSet([
      ['health.reminders.p.workoutday', 'false'],
      ['health.reminders.p.time', String(6 * 60)],
      ['health.reminders.p.checkinDay', '7'],
    ]);
    const loaded = await loadReminderPreferences('p');
    expect(loaded.workoutNotesOn).toBe(false);
    expect(loaded.workoutTimeMinutes).toBe(360);
    expect(loaded.checkInWeekday).toBe(7);
    expect(loaded.checkInOn).toBe(true);
  });
});

describe('the request itself', () => {
  it('testTheRequestIsLocalGroupedAndRouted', async () => {
    const reminder = plan({
      upcoming: [row('2026-09-21', 'swim', { title: 'Easy swim', minutes: 30 })],
      now: at('2026-09-18', 19),
    }).find((planned) => planned.kind === 'workoutDay')!;
    const request = notificationFor(reminder, 'is');
    expect(request.identifier).toBe('health.workoutday.2026-09-21');
    expect(request.content.title).toBe('Áætlun dagsins');
    expect(request.content.body).toBe('30 mínútna sund í dag.');
    // iOS's `health` thread is Android's `health` channel.
    expect(request.channel).toBe('health');
    expect(request.content.data).toEqual({ route: 'plan' });
    expect(request.date.getTime()).toBe(at('2026-09-21', 7).getTime());

    // Scheduled as a one-off date (never repeating) on the health channel.
    fakeClockOnly(at('2026-09-18', 19));
    await scheduleAt(request.identifier, request.date, request.content, request.channel);
    const [scheduled] = notificationsState.scheduled();
    expect(scheduled?.identifier).toBe('health.workoutday.2026-09-21');
    expect(scheduled?.trigger).toEqual({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at('2026-09-21', 7),
      channelId: 'health',
    });
    expect(scheduled?.content).toMatchObject({ title: 'Áætlun dagsins', data: { route: 'plan' } });
  });
});

describe('the Android port on its own', () => {
  it('a phone abroad keeps the plan date and uses its own wall clock', () => {
    // Whatever zone the suite runs in, Monday's note is 07:00 on Monday on THIS phone.
    const desired = plan({ upcoming: [row('2026-09-21', 'strength')], now: at('2026-09-18', 19) });
    const monday = desired.find((reminder) => reminder.kind === 'workoutDay')!;
    const date = fireDate(monday.fire);
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]).toEqual([
      2026, 9, 21, 7, 0,
    ]);
  });

  it('every kind but rest and unknown is a workout; a missing kind is not, a missing status is planned', () => {
    const now = at('2026-09-18', 19);
    const kinds: SessionKind[] = ['strength', 'cardio', 'swim', 'mobility', 'hike', 'walk', 'class', 'rest', 'unknown'];
    const upcoming = kinds.map((kind, index) => row(`2026-09-${String(19 + index).padStart(2, '0')}`, kind));
    const ids = plan({ upcoming, now })
      .filter((reminder) => reminder.kind === 'workoutDay')
      .map((reminder) => reminder.identifier.slice(WORKOUT_PREFIX.length));
    expect(ids).toEqual(['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);

    const noKind = { ...row('2026-09-21', 'strength'), kind: null };
    const noStatus = { ...row('2026-09-22', 'swim'), status: null };
    const unknownStatus = row('2026-09-23', 'strength', { status: 'unknown' });
    const missed = row('2026-09-24', 'strength', { status: 'missed' });
    expect(
      plan({ upcoming: [noKind, noStatus, unknownStatus, missed], now })
        .filter((reminder) => reminder.kind === 'workoutDay')
        .map((reminder) => reminder.identifier),
    ).toEqual(['health.workoutday.2026-09-22']);
  });

  it('two rows on one date give one note: the first', () => {
    const now = at('2026-09-18', 19);
    const desired = plan({ upcoming: [row('2026-09-21', 'swim', { title: 'Swim' }), row('2026-09-21', 'strength')], now });
    const workout = desired.filter((reminder) => reminder.kind === 'workoutDay');
    expect(workout).toHaveLength(1);
    expect(workout[0]?.bodyKey).toBe('notif.health.swim.body');
  });

  it("a rest pick never replaces tomorrow's workout note, and needs a live plan with notes on", () => {
    const now = at('2026-09-20', 20, 45);
    const tomorrow: TomorrowRead = { date: '2026-09-21', isRest: true, notificationKey: 'rest_pick' };
    const withWorkout = plan({ upcoming: [row('2026-09-21', 'strength')], tomorrow, now });
    expect(withWorkout.filter((reminder) => reminder.identifier === 'health.workoutday.2026-09-21').map((r) => r.kind)).toEqual([
      'workoutDay',
    ]);
    expect(plan({ upcoming: [], tomorrow, programActive: false, now }).some((r) => r.kind === 'restPick')).toBe(false);
    expect(
      plan({ upcoming: [], tomorrow, prefs: { ...DEFAULTS, workoutNotesOn: false }, now }).some((r) => r.kind === 'restPick'),
    ).toBe(false);
    // A pick on a day that is not a rest day is no rest note.
    expect(plan({ upcoming: [], tomorrow: { ...tomorrow, isRest: false }, now }).some((r) => r.kind === 'restPick')).toBe(false);
  });

  it("a note for another day does not change this day's line", () => {
    const desired = plan({
      upcoming: [row('2026-09-19', 'strength')],
      todayNote: note('2026-09-18', 'lighter'),
      now: at('2026-09-18', 19),
    });
    expect(desired[0]?.bodyKey).toBe('notif.health.workout.body');
    expect(desired[0]?.params).toEqual({ title: 'Full body strength', minutes: '40' });
  });

  it('every variant key has its fixed line', () => {
    const now = at('2026-09-18', 6);
    const line = (key: string) =>
      plan({ upcoming: [row('2026-09-18', 'strength')], todayNote: note('2026-09-18', key), now })[0]?.bodyKey;
    expect(line('moved_rest')).toBe('notif.health.note.moved_rest');
    expect(line('indoor_swap')).toBe('notif.health.note.indoor_swap');
    // `rest_pick` is a rest day's, never a workout's line.
    expect(line('rest_pick')).toBe('notif.health.workout.body');
  });

  it('the minutes are at least 1, and a missing title adds no title', () => {
    expect(paramsFor({ title: 'Easy swim', minutes: 0 })).toEqual({ title: 'Easy swim', minutes: '1' });
    expect(paramsFor({ title: null, minutes: null })).toEqual({ minutes: '1' });
    expect(paramsFor({ title: '', minutes: 25 })).toEqual({ minutes: '25' });
  });

  it('reads a plan date the way Swift does', () => {
    expect(fireComponents('2026-09-21', 7, 0)).toEqual(fire(2026, 9, 21, 7, 0));
    expect(fireComponents('2026--09-21', 7, 0)).toEqual(fire(2026, 9, 21, 7, 0));
    expect(fireComponents('2026-09', 7, 0)).toBeNull();
    expect(fireComponents('2026-09-xx', 7, 0)).toBeNull();
    expect(fireComponents('not a day', 7, 0)).toBeNull();
    const upcoming = [{ ...row('2026-09-21', 'strength'), scheduledFor: 'soon' }, { ...row('x', 'strength'), scheduledFor: null }];
    expect(plan({ upcoming, now: at('2026-09-18', 19) }).filter((r) => r.kind === 'workoutDay')).toEqual([]);
  });

  it('the check-in is at least a minute away, else next week', () => {
    // Monday 07:29:00: 07:30 is still a minute away.
    expect(weeklyCheckInFire(1, 450, null, at('2026-09-21', 7, 29))).toEqual(fire(2026, 9, 21, 7, 30));
    // Monday 07:29:30: too close, the Monday after.
    expect(weeklyCheckInFire(1, 450, null, at('2026-09-21', 7, 29, 30))).toEqual(fire(2026, 9, 28, 7, 30));
    // Saturday: the coming Monday and the coming Sunday.
    expect(weeklyCheckInFire(1, 450, null, at('2026-09-19', 12))).toEqual(fire(2026, 9, 21, 7, 30));
    expect(weeklyCheckInFire(7, 450, null, at('2026-09-19', 12))).toEqual(fire(2026, 9, 20, 7, 30));
    // Across a month end.
    expect(weeklyCheckInFire(1, 450, null, at('2026-09-29', 12))).toEqual(fire(2026, 10, 5, 7, 30));
  });

  it('the planner family is the workout notes and the check-in, not the rest timer or the feedback', () => {
    expect(isPlannerIdentifier('health.workoutday.2026-09-21')).toBe(true);
    expect(isPlannerIdentifier(CHECK_IN_IDENTIFIER)).toBe(true);
    expect(isPlannerIdentifier('health.resttimer')).toBe(false);
    expect(isPlannerIdentifier('health.feedback.monthly.2026-10')).toBe(false);
    expect(isPlannerIdentifier('engagement.stayactive')).toBe(false);
  });

  it('no line on a lock screen carries a digit of its own (only the session minutes)', () => {
    const keys = [
      'notif.health.workout.title',
      'notif.health.checkin.title',
      'notif.health.rest_pick.body',
      'notif.health.note.lighter',
      'notif.health.note.moved_rest',
      'notif.health.note.indoor_swap',
    ];
    for (const language of ['en', 'is'] as const) {
      for (const key of keys) {
        const reminder: PlannedReminder = {
          kind: 'workoutDay',
          identifier: 'health.workoutday.2026-09-21',
          fire: fire(2026, 9, 21, 7, 0),
          titleKey: key,
          bodyKey: key,
          params: {},
          route: 'plan',
        };
        expect(notificationFor(reminder, language).content.body).not.toMatch(/\d/);
      }
    }
  });
});
