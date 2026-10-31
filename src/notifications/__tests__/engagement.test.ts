/**
 * The engagement nudges (iOS EngagementNotificationService, NOTIFICATIONS.md
 * phase 1): the planner table first (the ladder, stay-active, visits-reset,
 * the one-hour and one-minute rules), then the sync over the stores, the
 * stored first open and the permission.
 *
 * Times are wall-clock times on the phone (`new Date(y, m, d, h, min)`), as
 * iOS builds them on `Calendar.current`, so the suite reads the same in UTC,
 * New York and Tokyo.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import { decodeProfile, type Profile, type Usage, type UsageLane } from '../../api/profile';
import type { Subscription } from '../../api/subscriptions';
import { resetHealthStoreForTests } from '../../health/store';
import { translate } from '../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import {
  at18,
  ENGAGEMENT_IDS,
  FIRST_OPEN_KEY,
  firstOpenDate,
  planEngagementNudges,
  resetEngagementForTests,
  runEngagementSync,
  syncEngagementNudges,
  type EngagementInput,
  type EngagementPlan,
} from '../engagement';
import { scheduleAt } from '../scheduler';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

/** A wall-clock time on the phone. 2026-10-05 is a Monday. */
function at(day: string, hour: number, minute = 0, second = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute, second);
}

/** Only the clock is faked; promises, timers and the stub network run for real. */
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

function input(overrides: Partial<EngagementInput> & Pick<EngagementInput, 'now'>): EngagementInput {
  return {
    hasPurchase: false,
    hasLiveProgram: false,
    firstOpen: overrides.now,
    network: null,
    ...overrides,
  };
}

const ids = (plan: EngagementPlan) => plan.schedule.map((nudge) => nudge.id);
const nudge = (plan: EngagementPlan, id: string) => plan.schedule.find((n) => n.id === id);

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// The planner

describe('no purchase: the conversion ladder', () => {
  it('fires day 5 and day 12 at 18:00 after the first open, and takes the subscriber nudges off', () => {
    const firstOpen = at('2026-10-05', 9, 14);
    const plan = planEngagementNudges(input({ firstOpen, now: firstOpen }));
    expect(ids(plan)).toEqual([ENGAGEMENT_IDS.noPurchaseDay5, ENGAGEMENT_IDS.noPurchaseDay12]);
    expect(nudge(plan, ENGAGEMENT_IDS.noPurchaseDay5)?.fireAt).toEqual(at('2026-10-10', 18));
    expect(nudge(plan, ENGAGEMENT_IDS.noPurchaseDay12)?.fireAt).toEqual(at('2026-10-17', 18));
    expect(nudge(plan, ENGAGEMENT_IDS.noPurchaseDay5)).toMatchObject({
      titleKey: 'notif.nopurchase.d5.title',
      bodyKey: 'notif.nopurchase.d5.body',
      params: {},
    });
    expect(nudge(plan, ENGAGEMENT_IDS.noPurchaseDay12)).toMatchObject({
      titleKey: 'notif.nopurchase.d12.title',
      bodyKey: 'notif.nopurchase.d12.body',
    });
    expect(plan.remove).toEqual([ENGAGEMENT_IDS.stayActive, ENGAGEMENT_IDS.visitsReset]);
  });

  it('a first open late in the evening still counts its days on the calendar', () => {
    const firstOpen = at('2026-10-05', 23, 50);
    const plan = planEngagementNudges(input({ firstOpen, now: firstOpen }));
    expect(nudge(plan, ENGAGEMENT_IDS.noPurchaseDay5)?.fireAt).toEqual(at('2026-10-10', 18));
  });

  it('a rung an hour or less away is removed, never fired late', () => {
    const firstOpen = at('2026-10-05', 9);
    // Day 5 at 17:00:00: exactly an hour away is not "more than an hour".
    const hourAway = planEngagementNudges(input({ firstOpen, now: at('2026-10-10', 17) }));
    expect(ids(hourAway)).toEqual([ENGAGEMENT_IDS.noPurchaseDay12]);
    expect(hourAway.remove).toContain(ENGAGEMENT_IDS.noPurchaseDay5);
    // A second earlier it is still on.
    const justMore = planEngagementNudges(input({ firstOpen, now: at('2026-10-10', 16, 59, 59) }));
    expect(ids(justMore)).toEqual([ENGAGEMENT_IDS.noPurchaseDay5, ENGAGEMENT_IDS.noPurchaseDay12]);
    expect(justMore.remove).not.toContain(ENGAGEMENT_IDS.noPurchaseDay5);
  });

  it('on day 40 both rungs are gone: "five days with the app" is noise by then', () => {
    const plan = planEngagementNudges(input({ firstOpen: at('2026-09-01', 9), now: at('2026-10-11', 12) }));
    expect(plan.schedule).toEqual([]);
    expect(plan.remove).toEqual([
      ENGAGEMENT_IDS.stayActive,
      ENGAGEMENT_IDS.visitsReset,
      ENGAGEMENT_IDS.noPurchaseDay5,
      ENGAGEMENT_IDS.noPurchaseDay12,
    ]);
  });

  it('a live plan without a purchase changes nothing on the ladder', () => {
    const firstOpen = at('2026-10-05', 9);
    const plan = planEngagementNudges(input({ firstOpen, now: firstOpen, hasLiveProgram: true }));
    expect(ids(plan)).toEqual([ENGAGEMENT_IDS.noPurchaseDay5, ENGAGEMENT_IDS.noPurchaseDay12]);
  });
});

describe('a purchase: stay active and visits reset', () => {
  const now = at('2026-10-05', 10, 30);
  const lane = (used: number, cap: number, resetsAt: Date | null): UsageLane => ({ used, cap, resetsAt });

  it('removes the ladder and arms stay-active for 18:00 seven days from now', () => {
    const plan = planEngagementNudges(input({ hasPurchase: true, firstOpen: at('2026-10-04', 9), now }));
    expect(plan.remove).toEqual([ENGAGEMENT_IDS.noPurchaseDay5, ENGAGEMENT_IDS.noPurchaseDay12, ENGAGEMENT_IDS.visitsReset]);
    expect(ids(plan)).toEqual([ENGAGEMENT_IDS.stayActive]);
    expect(nudge(plan, ENGAGEMENT_IDS.stayActive)).toEqual({
      id: ENGAGEMENT_IDS.stayActive,
      fireAt: at('2026-10-12', 18),
      titleKey: 'notif.stayactive.title',
      bodyKey: 'notif.stayactive.body',
      params: {},
    });
  });

  it('each activation moves stay-active out again, so it only fires after seven silent days', () => {
    const later = planEngagementNudges(input({ hasPurchase: true, now: at('2026-10-09', 21) }));
    expect(nudge(later, ENGAGEMENT_IDS.stayActive)?.fireAt).toEqual(at('2026-10-16', 18));
  });

  it('a live plan (active or paused) takes stay-active off, and touches nothing else', () => {
    const plan = planEngagementNudges(
      input({ hasPurchase: true, hasLiveProgram: true, network: lane(2, 8, at('2026-10-20', 0)), now }),
    );
    expect(plan.remove).toContain(ENGAGEMENT_IDS.stayActive);
    expect(ids(plan)).toEqual([ENGAGEMENT_IDS.visitsReset]);
  });

  it('visits reset: 18:00 three days before the reset, with the visits still left', () => {
    const plan = planEngagementNudges(input({ hasPurchase: true, network: lane(3, 8, at('2026-10-20', 0)), now }));
    expect(nudge(plan, ENGAGEMENT_IDS.visitsReset)).toEqual({
      id: ENGAGEMENT_IDS.visitsReset,
      fireAt: at('2026-10-17', 18),
      titleKey: 'notif.visitsreset.title',
      bodyKey: 'notif.visitsreset.body',
      params: { count: '5' },
    });
    expect(plan.remove).not.toContain(ENGAGEMENT_IDS.visitsReset);
  });

  it('visits reset only with visits left and the reset more than four days away', () => {
    const removed = (network: UsageLane | null, at0 = now) =>
      planEngagementNudges(input({ hasPurchase: true, network, now: at0 })).remove.includes(ENGAGEMENT_IDS.visitsReset);
    // Everything used, or more than the cap (a top-up month).
    expect(removed(lane(8, 8, at('2026-10-20', 0)))).toBe(true);
    expect(removed(lane(9, 8, at('2026-10-20', 0)))).toBe(true);
    // No reset date, no lane (a pass holder), a reset four days away exactly or closer.
    expect(removed(lane(3, 8, null))).toBe(true);
    expect(removed(null)).toBe(true);
    expect(removed(lane(3, 8, new Date(now.getTime() + 4 * 24 * 3600 * 1000)))).toBe(true);
    expect(removed(lane(3, 8, new Date(now.getTime() + 4 * 24 * 3600 * 1000 + 1000)))).toBe(false);
  });

  it('at18 counts calendar days either way and lands on 18:00', () => {
    expect(at18(-3, at('2026-11-01', 0))).toEqual(at('2026-10-29', 18));
    expect(at18(7, at('2026-12-28', 23, 59))).toEqual(at('2027-01-04', 18));
    expect(at18(0, at('2026-10-05', 19))).toEqual(at('2026-10-05', 18));
  });
});

// ---------------------------------------------------------------------------
// The sync

function subscription(status = 'active'): Subscription {
  return {
    id: 'sub-1',
    productSlug: 'plus',
    productName: 'Plus',
    status,
    currentPeriodStartsAt: at('2026-10-01', 0),
    currentPeriodEndsAt: at('2026-11-01', 0),
    cancelAtPeriodEnd: false,
    cancelledAt: null,
  };
}

function usage(network: UsageLane | null, passes: Usage['passes'] = []): Usage {
  return {
    tier: network ? 'plus' : null,
    network,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes,
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  };
}

function profile(
  options: { locale?: string; usage?: Usage | null; programStatus?: string } = {},
): Profile {
  const decoded = decodeProfile({
    id: MEMBER,
    locale: options.locale ?? 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    ...(options.programStatus
      ? { health: { access: 'entitled', consent: { version: '2026-09-v1' }, program: { id: 'prog-1', status: options.programStatus } } }
      : {}),
  });
  return { ...decoded, usage: options.usage ?? null };
}

/** A signed-in member with both reads answered. */
function signedIn(options: { profile?: Profile | null; subscription?: Subscription | null; subscriptionLoaded?: boolean } = {}): void {
  const p = options.profile === undefined ? profile() : options.profile;
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER,
    profile: p,
    language: p?.locale === 'is' ? 'is' : 'en',
    subscription: options.subscription ?? null,
    subscriptionLoaded: options.subscriptionLoaded ?? true,
  });
}

function signedOut(): void {
  useAppStore.setState({ isAuthenticated: false, isLoading: false, profile: null, subscription: null, subscriptionLoaded: false });
}

const scheduledIds = () => notificationsState.scheduled().map((request) => request.identifier).sort();

const NOW = at('2026-10-05', 10);

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetEngagementForTests();
});

describe('the sync waits for what it needs', () => {
  it('signed in, nothing happens until the plan read has answered: no prompt, no first open stored', async () => {
    fakeClockOnly(NOW);
    signedIn({ subscriptionLoaded: false });
    await syncEngagementNudges();
    expect(notificationsState.requestCount()).toBe(0);
    expect(notificationsState.scheduled()).toEqual([]);
    expect(await AsyncStorage.getItem(FIRST_OPEN_KEY)).toBeNull();
  });

  it('signed in, nothing happens until the profile has been read', async () => {
    fakeClockOnly(NOW);
    signedIn({ profile: null, subscription: subscription() });
    await syncEngagementNudges();
    expect(notificationsState.requestCount()).toBe(0);
    expect(notificationsState.scheduled()).toEqual([]);
  });

  it('signed out and never asked: waits, and never asks', async () => {
    fakeClockOnly(NOW);
    signedOut();
    await syncEngagementNudges();
    expect(notificationsState.requestCount()).toBe(0);
    expect(notificationsState.scheduled()).toEqual([]);
  });

  it('refused: nothing is scheduled, nothing is asked again', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('denied');
    signedIn();
    await syncEngagementNudges();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notificationsState.scheduled()).toEqual([]);
  });
});

describe('the sync', () => {
  it('asks on the first signed-in sync, then schedules the ladder in the account language on the engagement channel', async () => {
    fakeClockOnly(NOW);
    signedIn({ profile: profile({ locale: 'is' }) });
    await syncEngagementNudges();
    expect(notificationsState.requestCount()).toBe(1);
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.noPurchaseDay12, ENGAGEMENT_IDS.noPurchaseDay5]);
    const d5 = notificationsState.scheduled().find((request) => request.identifier === ENGAGEMENT_IDS.noPurchaseDay5)!;
    expect(d5.content.title).toBe(translate('notif.nopurchase.d5.title', 'is'));
    expect(d5.content.title).toBe('LifePass bíður eftir þér');
    expect(d5.content.body).toBe(translate('notif.nopurchase.d5.body', 'is'));
    // No route: a tap just opens the app.
    expect(d5.content.data).toEqual({});
    expect(d5.trigger).toEqual({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at('2026-10-10', 18),
      channelId: 'engagement',
    });
  });

  it('a member who says no at the prompt gets nothing', async () => {
    fakeClockOnly(NOW);
    notificationsState.answerNextRequestWith('denied');
    signedIn();
    await syncEngagementNudges();
    expect(notificationsState.requestCount()).toBe(1);
    expect(notificationsState.scheduled()).toEqual([]);
  });

  it('signed out with notifications on: the ladder, as on iOS', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('granted');
    signedOut();
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.noPurchaseDay12, ENGAGEMENT_IDS.noPurchaseDay5]);
  });

  it('the first open is stored once and every later sync counts from it', async () => {
    notificationsState.setPermission('granted');
    signedIn();
    fakeClockOnly(NOW);
    await syncEngagementNudges();
    expect(await AsyncStorage.getItem(FIRST_OPEN_KEY)).toBe(NOW.toISOString());

    fakeClockOnly(at('2026-10-08', 12));
    await syncEngagementNudges();
    const d5 = notificationsState.scheduled().find((request) => request.identifier === ENGAGEMENT_IDS.noPurchaseDay5)!;
    expect((d5.trigger as { date: Date }).date).toEqual(at('2026-10-10', 18));
    expect(await AsyncStorage.getItem(FIRST_OPEN_KEY)).toBe(NOW.toISOString());
  });

  it('a stored first open that is not a date is replaced', async () => {
    await AsyncStorage.setItem(FIRST_OPEN_KEY, 'yesterday');
    await expect(firstOpenDate(NOW)).resolves.toEqual(NOW);
    expect(await AsyncStorage.getItem(FIRST_OPEN_KEY)).toBe(NOW.toISOString());
  });

  it('a subscriber: the ladder goes, stay-active and visits-reset come, the count in the words', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('granted');
    await scheduleAt(ENGAGEMENT_IDS.noPurchaseDay5, at('2026-10-10', 18), { title: 'old', body: 'old' }, 'engagement');
    await scheduleAt(ENGAGEMENT_IDS.noPurchaseDay12, at('2026-10-17', 18), { title: 'old', body: 'old' }, 'engagement');
    signedIn({
      profile: profile({ usage: usage({ used: 1, cap: 8, resetsAt: at('2026-11-01', 0) }) }),
      subscription: subscription(),
    });
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.stayActive, ENGAGEMENT_IDS.visitsReset]);
    const reset = notificationsState.scheduled().find((request) => request.identifier === ENGAGEMENT_IDS.visitsReset)!;
    expect(reset.content.title).toBe('Your visits reset soon');
    expect(reset.content.body).toBe('You still have 7 visits this month. Use them before they reset.');
    expect((reset.trigger as { date: Date }).date).toEqual(at('2026-10-29', 18));
    const stay = notificationsState.scheduled().find((request) => request.identifier === ENGAGEMENT_IDS.stayActive)!;
    expect((stay.trigger as { date: Date }).date).toEqual(at('2026-10-12', 18));
  });

  it('a past-due membership is still a purchase, as is a visitor pass alone', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('granted');
    signedIn({ subscription: subscription('past_due') });
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.stayActive]);

    notificationsState.reset();
    notificationsState.setPermission('granted');
    const pass = { id: 'pass-1', type: 'explorer', visitsLeft: 3, expiresAt: at('2026-10-30', 0) };
    signedIn({ profile: profile({ usage: usage(null, [pass]) }) });
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.stayActive]);
  });

  it('a live plan on the profile takes stay-active off for a subscriber', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('granted');
    await scheduleAt(ENGAGEMENT_IDS.stayActive, at('2026-10-11', 18), { title: 'old', body: 'old' }, 'engagement');
    signedIn({ profile: profile({ programStatus: 'paused' }), subscription: subscription() });
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual([]);
  });

  it('touches no other notification family', async () => {
    fakeClockOnly(NOW);
    notificationsState.setPermission('granted');
    await scheduleAt('health.weeklycheckin', at('2026-10-12', 7, 30), { title: 'x', body: 'y' }, 'health');
    await scheduleAt('class-checkin-reminder-1', at('2026-10-06', 9), { title: 'x', body: 'y' }, 'bookings');
    signedIn({ subscription: subscription() });
    await syncEngagementNudges();
    expect(scheduledIds()).toEqual(['class-checkin-reminder-1', ENGAGEMENT_IDS.stayActive, 'health.weeklycheckin']);
  });

  it('a burst of syncs runs one after another and asks once', async () => {
    fakeClockOnly(NOW);
    signedIn();
    const runs = [runEngagementSync(), runEngagementSync(), runEngagementSync()];
    await Promise.all(runs);
    expect(notificationsState.requestCount()).toBe(1);
    expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
    expect(scheduledIds()).toEqual([ENGAGEMENT_IDS.noPurchaseDay12, ENGAGEMENT_IDS.noPurchaseDay5]);
  });
});
