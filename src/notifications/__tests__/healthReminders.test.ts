/**
 * The health reminder sync (iOS `HealthReminderService.sync`, `ios-ux.md`
 * 19.2 to 19.4): the pending workout notes and weekly check-in made equal to
 * the planner's answer over the Today read, the member's choices and the
 * permission, and nothing else touched. The planner itself is
 * ./healthReminderPlanner.test.ts.
 *
 * Plan dates are server (Iceland) dates and fire times are the phone's wall
 * clock, so every expectation is built from `todayServerDay(now)` and
 * `at(date, hh, mm)` on the phone: the suite reads the same in UTC, New York
 * and Tokyo.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { decodeProfile, type Profile } from '../../api/profile';
import { decodeHealthDay, ReminderKeys } from '../../health';
import { resetHealthStoreForTests, useHealthStore } from '../../health/store';
import { addServerDays, todayServerDay } from '../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { CHECK_IN_IDENTIFIER, WORKOUT_PREFIX } from '../healthReminderPlanner';
import {
  HEALTH_REMINDER_SYNC_DELAY_MS,
  resetHealthRemindersForTests,
  runHealthReminderSync,
  scheduleHealthReminderSync,
  syncHealthReminders,
} from '../healthReminders';
import { scheduleAt } from '../scheduler';

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '2b6f0c1e-7d3a-4e55-9a51-0c8d1e2f3a44';

/** A wall-clock time on the phone. */
function at(day: string, hour: number, minute = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute, 0);
}

/** The real setImmediate, for letting promise chains and the stub network finish under fake timers. */
const realSetImmediate = globalThis.setImmediate;
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => realSetImmediate(resolve));
}

/** The clock (and, with `timers`, setTimeout) faked; promises and the stub network run for real. */
function fakeClock(now: Date, options: { timers?: boolean } = {}): void {
  const keep = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate'] as const;
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
  jest.useFakeTimers({ now, doNotFake: options.timers ? [...keep] : [...keep, ...timers] });
}

function profile(id = MEMBER, health: Record<string, unknown> | null = { access: 'entitled', consent: { version: '2026-09-v1' } }): Profile {
  return decodeProfile({ id, locale: 'is', kennitalaVerified: true, marketingConsent: false, ...(health ? { health } : {}) });
}

/** Signed in; the store derives the language and the health access from the profile. */
function signedIn(options: { profile?: Profile } = {}): void {
  const p = options.profile ?? profile();
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: p.id, profile: p });
}

interface DayOptions {
  readonly date: string;
  readonly programStatus?: string;
  readonly upcoming?: readonly Record<string, unknown>[];
  readonly session?: Record<string, unknown> | null;
  readonly movedAway?: Record<string, unknown>;
  readonly note?: Record<string, unknown>;
  readonly review?: Record<string, unknown>;
}

function dayJSON(options: DayOptions): Record<string, unknown> {
  return {
    contractVersion: '2026-09-v1',
    date: options.date,
    today: options.date,
    locale: 'is',
    access: 'entitled',
    program: { id: 'prog-1', status: options.programStatus ?? 'active' },
    day: {
      date: options.date,
      relative: 'today',
      session: options.session === undefined ? null : options.session,
      ...(options.movedAway ? { movedAway: options.movedAway } : {}),
    },
    upcoming: options.upcoming ?? [],
    ...(options.note ? { note: options.note } : {}),
    ...(options.review ? { review: options.review } : {}),
    features: [],
  };
}

function setToday(options: DayOptions): void {
  useHealthStore.setState({ today: decodeHealthDay(dayJSON(options)) });
}

function brief(date: string, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `s-${date}`, programId: 'prog-1', scheduledFor: date, kind, title: 'Full body strength', minutes: 40, status: 'planned', ...extra };
}

const scheduled = (identifier: string) => notificationsState.scheduled().find((request) => request.identifier === identifier);
const scheduledIds = () => notificationsState.scheduled().map((request) => request.identifier).sort();
const fireAt = (identifier: string) => (scheduled(identifier)?.trigger as { date: Date } | undefined)?.date;
const later = { title: 'x', body: 'y' };

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetHealthRemindersForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

// 2026-09-18 is a Friday. Noon on the phone is the same date in Reykjavik
// from UTC-11 to UTC+11, so `serverToday` is 2026-09-18 in every CI zone.
const FRIDAY_NOON = at('2026-09-18', 12);

describe('planning from Today', () => {
  it('schedules the workout notes ahead and the check-in, in the account language, on the health channel', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    const today = todayServerDay(FRIDAY_NOON);
    expect(today).toBe('2026-09-18');
    setToday({
      date: today,
      upcoming: [
        brief('2026-09-18', 'strength'),
        brief('2026-09-19', 'swim', { title: 'Easy swim', minutes: 30 }),
        brief('2026-09-20', 'rest', { title: null, minutes: 0, status: 'rest' }),
        brief('2026-09-21', 'strength'),
      ],
    });
    await syncHealthReminders();

    // Today's 07:00 has passed; Sunday is rest.
    expect(scheduledIds()).toEqual([CHECK_IN_IDENTIFIER, 'health.workoutday.2026-09-19', 'health.workoutday.2026-09-21']);
    const swim = scheduled('health.workoutday.2026-09-19')!;
    expect(swim.content).toEqual({ title: 'Áætlun dagsins', body: '30 mínútna sund í dag.', data: { route: 'plan' } });
    expect(swim.trigger).toEqual({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at('2026-09-19', 7),
      channelId: 'health',
    });
    const checkIn = scheduled(CHECK_IN_IDENTIFIER)!;
    expect(checkIn.content).toEqual({
      title: 'Vikuyfirferð',
      body: 'Hvernig gekk vikan? Það tekur innan við mínútu.',
      data: { route: 'plan.checkin' },
    });
    expect(fireAt(CHECK_IN_IDENTIFIER)).toEqual(at('2026-09-21', 7, 30));
    // Never a prompt from here.
    expect(notificationsState.requestCount()).toBe(0);
  });

  it('removes what is no longer wanted and leaves the rest timer, the feedback and the nudges alone', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    await scheduleAt('health.workoutday.2026-09-20', at('2026-09-20', 7), later, 'health');
    await scheduleAt('health.resttimer', at('2026-09-18', 12, 2), later, 'rest_timer');
    await scheduleAt('health.feedback.monthly', at('2026-10-01', 9), later, 'health');
    await scheduleAt('engagement.stayactive', at('2026-09-25', 18), later, 'engagement');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduledIds()).toEqual([
      'engagement.stayactive',
      'health.feedback.monthly',
      'health.resttimer',
      CHECK_IN_IDENTIFIER,
      'health.workoutday.2026-09-21',
    ]);
  });

  it('the same identifier again replaces its words in place (a variant from a new read)', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduled('health.workoutday.2026-09-21')?.content.body).toBe(
      'Full body strength, 40 mín. Opnaðu Áætlun þegar þú ert tilbúin(n).',
    );

    // The planner swaps the line for the note's date (on that day, it is today's note).
    setToday({
      date: '2026-09-18',
      upcoming: [brief('2026-09-21', 'strength')],
      note: { date: '2026-09-21', title: 'A lighter day', body: 'You slept 5 h 12 min.', notificationKey: 'lighter' },
    });
    await syncHealthReminders();
    expect(scheduled('health.workoutday.2026-09-21')?.content.body).toBe('Æfing dagsins er léttari útgáfan.');
    expect(notificationsState.scheduled().filter((r) => r.identifier.startsWith(WORKOUT_PREFIX))).toHaveLength(1);
  });

  it("a paused plan gives no workout notes; the check-in stays", async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    await scheduleAt('health.workoutday.2026-09-21', at('2026-09-21', 7), later, 'health');
    signedIn();
    setToday({ date: '2026-09-18', programStatus: 'paused', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduledIds()).toEqual([CHECK_IN_IDENTIFIER]);
  });

  it("the member's choices from Body and goals, missing keys reading as the defaults", async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await AsyncStorage.multiSet([
      [ReminderKeys.time(MEMBER), String(6 * 60 + 30)],
      [ReminderKeys.checkInDay(MEMBER), '7'],
      [ReminderKeys.checkInTime(MEMBER), String(19 * 60)],
    ]);
    await syncHealthReminders();
    expect(fireAt('health.workoutday.2026-09-21')).toEqual(at('2026-09-21', 6, 30));
    expect(fireAt(CHECK_IN_IDENTIFIER)).toEqual(at('2026-09-20', 19));

    await AsyncStorage.multiSet([
      [ReminderKeys.workoutDay(MEMBER), 'false'],
      [ReminderKeys.weeklyCheckIn(MEMBER), 'false'],
    ]);
    await syncHealthReminders();
    expect(scheduledIds()).toEqual([]);
  });

  it("the check-in moves a week when the week it would ask about already has a review", async () => {
    fakeClock(at('2026-09-21', 6));
    notificationsState.setPermission('granted');
    signedIn();
    setToday({ date: todayServerDay(at('2026-09-21', 6)), review: { id: 'r-1', weekStartsOn: '2026-09-14' } });
    await syncHealthReminders();
    expect(fireAt(CHECK_IN_IDENTIFIER)).toEqual(at('2026-09-28', 7, 30));
  });
});

describe('what the sync never does', () => {
  it('never asks: not asked yet means stop, with what is pending left as it is', async () => {
    fakeClock(FRIDAY_NOON);
    await scheduleAt('health.workoutday.2026-09-20', at('2026-09-20', 7), later, 'health');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(notificationsState.requestCount()).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(scheduledIds()).toEqual(['health.workoutday.2026-09-20']);
  });

  it('refused: every workout note and the check-in go; the rest timer and the nudges stay', async () => {
    fakeClock(FRIDAY_NOON);
    for (const id of ['health.workoutday.2026-09-21', CHECK_IN_IDENTIFIER]) await scheduleAt(id, at('2026-09-21', 7), later, 'health');
    await scheduleAt('health.resttimer', at('2026-09-18', 12, 2), later, 'rest_timer');
    await scheduleAt('engagement.stayactive', at('2026-09-25', 18), later, 'engagement');
    notificationsState.setPermission('denied');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduledIds()).toEqual(['engagement.stayactive', 'health.resttimer']);
  });

  it.each([
    ['without consent', () => signedIn({ profile: profile(MEMBER, { access: 'entitled' }) })],
    [
      'without an entitled membership',
      () => signedIn({ profile: profile(MEMBER, { access: 'pass_only', consent: { version: '2026-09-v1' } }) }),
    ],
  ])('%s, the planner has nothing pending', async (_name, setUp) => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    for (const id of ['health.workoutday.2026-09-21', CHECK_IN_IDENTIFIER]) await scheduleAt(id, at('2026-09-21', 7), later, 'health');
    setUp();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduledIds()).toEqual([]);
  });

  it("without today's read, or with another day's, what is pending stays", async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    await scheduleAt('health.workoutday.2026-09-20', at('2026-09-20', 7), later, 'health');
    signedIn();
    await syncHealthReminders();
    expect(scheduledIds()).toEqual(['health.workoutday.2026-09-20']);

    setToday({ date: '2026-09-17', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(scheduledIds()).toEqual(['health.workoutday.2026-09-20']);
  });

  it('signed out: nothing at all', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    await syncHealthReminders();
    expect(notificationsState.scheduled()).toEqual([]);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the delivered note for today', () => {
  async function deliveredToday(today: string): Promise<void> {
    await scheduleAt(WORKOUT_PREFIX + today, new Date(Date.now() + 60_000), later, 'health');
    await notificationsState.fire(WORKOUT_PREFIX + today);
  }
  const presentedIds = () => notificationsState.presented().map((n) => n.request.identifier);

  it.each([
    ['done', { session: { id: 's-today', kind: 'strength', status: 'done' } }],
    ['skipped', { session: { id: 's-today', kind: 'strength', status: 'skipped' } }],
    ['moved away', { movedAway: { sessionId: 's-today', movedTo: '2026-09-19' } }],
  ])("leaves the shade once today's session is %s", async (_name, change) => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    await deliveredToday('2026-09-18');
    setToday({ date: '2026-09-18', ...change });
    await syncHealthReminders();
    expect(presentedIds()).toEqual([]);
  });

  it('stays while the session is still to do', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    await deliveredToday('2026-09-18');
    setToday({ date: '2026-09-18', session: { id: 's-today', kind: 'strength', status: 'planned' } });
    await syncHealthReminders();
    expect(presentedIds()).toEqual(['health.workoutday.2026-09-18']);
  });
});

describe('the evening read of tomorrow (19.4)', () => {
  // Sunday evening on the phone; `today` and `tomorrow` are whatever
  // Reykjavik says at that instant (in New York it is already Monday there).
  const SUNDAY_EVENING = at('2026-09-20', 20, 45);

  function tomorrowReply(date: string, extra: Partial<DayOptions> = {}): StubReply {
    return Reply.ok(
      dayJSON({
        date,
        session: { id: 'rest', kind: 'rest', status: 'rest' },
        note: { date, notificationKey: 'rest_pick' },
        ...extra,
      }),
    );
  }

  function eveningSetUp(now = SUNDAY_EVENING): { today: string; tomorrow: string } {
    fakeClock(now);
    notificationsState.setPermission('granted');
    signedIn();
    const today = todayServerDay(now);
    const tomorrow = addServerDays(today, 1)!;
    setToday({ date: today, session: { id: 's-today', kind: 'strength', status: 'done' } });
    return { today, tomorrow };
  }

  it("reads tomorrow once after 20:30 and gives tomorrow's rest day its note", async () => {
    const { tomorrow } = eveningSetUp();
    api.on('GET', '/health', (request) => tomorrowReply(request.query.date ?? ''));
    await syncHealthReminders();
    expect(api.sent('/health').query).toEqual({ locale: 'is', date: tomorrow });
    const rest = scheduled(WORKOUT_PREFIX + tomorrow)!;
    expect(rest.content).toEqual({ title: 'Áætlun dagsins', body: 'Hvíldardagur. Laug eða stuttur göngutúr?', data: { route: 'plan' } });
    expect(fireAt(WORKOUT_PREFIX + tomorrow)).toEqual(at(tomorrow, 7));
  });

  it('keeps the read for an hour, then reads again', async () => {
    eveningSetUp();
    api.on('GET', '/health', (request) => tomorrowReply(request.query.date ?? ''));
    await syncHealthReminders();
    jest.setSystemTime(new Date(SUNDAY_EVENING.getTime() + 59 * 60_000));
    await syncHealthReminders();
    expect(api.sentAll('/health')).toHaveLength(1);
    jest.setSystemTime(new Date(SUNDAY_EVENING.getTime() + 61 * 60_000));
    await syncHealthReminders();
    expect(api.sentAll('/health')).toHaveLength(2);
  });

  it('a read kept for one member is never used for the next', async () => {
    const { tomorrow } = eveningSetUp();
    api.on('GET', '/health', (request) => tomorrowReply(request.query.date ?? ''));
    await syncHealthReminders();
    signedIn({ profile: profile(OTHER) });
    setToday({ date: todayServerDay(SUNDAY_EVENING) });
    await syncHealthReminders();
    expect(api.sentAll('/health')).toHaveLength(2);
    expect(scheduled(WORKOUT_PREFIX + tomorrow)).toBeDefined();
  });

  it('before 20:30, or without an active plan, tomorrow is not read', async () => {
    eveningSetUp(at('2026-09-20', 20, 29));
    await syncHealthReminders();
    expect(api.sentAll('/health')).toHaveLength(0);

    resetHealthRemindersForTests();
    const { today } = eveningSetUp();
    setToday({ date: today, programStatus: 'paused' });
    await syncHealthReminders();
    expect(api.sentAll('/health')).toHaveLength(0);
  });

  it('a rest day without a pick, or a failed read, gives tomorrow no note', async () => {
    const { tomorrow } = eveningSetUp();
    api.on('GET', '/health', (request) => tomorrowReply(request.query.date ?? '', { note: { date: tomorrow } }));
    await syncHealthReminders();
    expect(scheduled(WORKOUT_PREFIX + tomorrow)).toBeUndefined();

    resetHealthRemindersForTests();
    api.on('GET', '/health', Reply.problem(503, 'unavailable'));
    await syncHealthReminders();
    expect(scheduled(WORKOUT_PREFIX + tomorrow)).toBeUndefined();
    // The check-in does not wait on tomorrow.
    expect(scheduled(CHECK_IN_IDENTIFIER)).toBeDefined();
  });

  it('a sign-out while tomorrow was being read schedules nothing for the member who left', async () => {
    eveningSetUp();
    let release: () => void = () => undefined;
    api.on(
      'GET',
      '/health',
      (request) =>
        new Promise<StubReply>((resolve) => {
          release = () => resolve(tomorrowReply(request.query.date ?? ''));
        }),
    );
    const sync = syncHealthReminders();
    await settle();
    useAppStore.setState({ isAuthenticated: false, profile: null, userId: null });
    release();
    await sync;
    expect(notificationsState.scheduled()).toEqual([]);
  });
});

describe('coalescing', () => {
  it('a burst of changes becomes one sync, 400 ms after the last', async () => {
    fakeClock(FRIDAY_NOON, { timers: true });
    notificationsState.setPermission('granted');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    scheduleHealthReminderSync();
    jest.advanceTimersByTime(300);
    scheduleHealthReminderSync();
    jest.advanceTimersByTime(HEALTH_REMINDER_SYNC_DELAY_MS - 1);
    await settle();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await settle();
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(scheduledIds()).toEqual([CHECK_IN_IDENTIFIER, 'health.workoutday.2026-09-21']);
  });

  it('syncs never overlap: one running and at most one waiting, which every later request joins', async () => {
    fakeClock(FRIDAY_NOON);
    notificationsState.setPermission('granted');
    signedIn();
    setToday({ date: '2026-09-18', upcoming: [brief('2026-09-21', 'strength')] });
    const first = runHealthReminderSync();
    // The first is running now (asking the permission state); the next two wait as one.
    await Promise.resolve();
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
    const second = runHealthReminderSync();
    expect(runHealthReminderSync()).toBe(second);
    await Promise.all([first, second]);
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(scheduledIds()).toEqual([CHECK_IN_IDENTIFIER, 'health.workoutday.2026-09-21']);
  });
});
