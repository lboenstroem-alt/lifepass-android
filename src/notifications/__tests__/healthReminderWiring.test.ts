/**
 * What sets the health reminder sync off (iOS `ContentView` and Body and
 * goals): a changed reminder choice or the permission just answered there,
 * every change to the Today read, a Today read settling, a consent or
 * membership change, each activation (never alongside a Today read in
 * flight); and a sign-out drops a sync still waiting. Every one of them is
 * coalesced into one sync 400 ms after the last.
 *
 * Its own file: the wiring subscribes to the stores for the life of the
 * module, which would set syncs off in every other suite's test.
 */
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import { decodeProfile, type Profile } from '../../api/profile';
import type { ActivationHook, SignOutCleaner } from '../../app/signOut';
import { requestReminderSync } from '../../features/body';
import { decodeHealthDay } from '../../health';
import { resetHealthStoreForTests, useHealthStore } from '../../health/store';
import { todayServerDay } from '../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { HEALTH_REMINDER_SYNC_DELAY_MS, installHealthReminders, resetHealthRemindersForTests } from '../healthReminders';

const mockHooks: { activation: Record<string, ActivationHook>; signOut: Record<string, SignOutCleaner> } = {
  activation: {},
  signOut: {},
};

// Only this module's hooks, captured: the real registry would load every
// package's register file and run their hooks too.
jest.mock('../../app/signOut', () => ({
  registerActivationHook: (id: string, hook: ActivationHook) => {
    mockHooks.activation[id] = hook;
    return () => undefined;
  },
  registerSignOutCleaner: (id: string, cleaner: SignOutCleaner) => {
    mockHooks.signOut[id] = cleaner;
    return () => undefined;
  },
}));

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const NOW = new Date(2026, 8, 18, 12, 0, 0);

const realSetImmediate = globalThis.setImmediate;
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => realSetImmediate(resolve));
}

function profile(consent = true): Profile {
  return decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access: 'entitled', ...(consent ? { consent: { version: '2026-09-v1' } } : {}) },
  });
}

function today(upcoming: readonly Record<string, unknown>[] = []) {
  const date = todayServerDay(NOW);
  return decodeHealthDay({ date, today: date, program: { id: 'prog-1', status: 'active' }, upcoming, features: [] });
}

/** Syncs run so far (each one reads the permission state once, first thing). */
const syncs = () => (Notifications.getPermissionsAsync as jest.Mock).mock.calls.length;

/** Past the coalescing delay, and every promise after it. */
async function afterDelay(): Promise<void> {
  jest.advanceTimersByTime(HEALTH_REMINDER_SYNC_DELAY_MS);
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'hrtime', 'performance'] });
  installHealthReminders();
  notificationsState.setPermission('granted');
  resetAppStoreForTests();
  resetHealthStoreForTests();
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: MEMBER, profile: profile() });
  // Whatever the set-up itself set off is not this test's.
  resetHealthRemindersForTests();
});

afterEach(() => {
  resetHealthRemindersForTests();
  jest.useRealTimers();
});

it('a change in Body and goals syncs once, 400 ms later', async () => {
  requestReminderSync();
  requestReminderSync();
  jest.advanceTimersByTime(HEALTH_REMINDER_SYNC_DELAY_MS - 1);
  await settle();
  expect(syncs()).toBe(0);
  await afterDelay();
  expect(syncs()).toBe(1);
});

it('installing again adds nothing: one sync per request', async () => {
  installHealthReminders();
  requestReminderSync();
  await afterDelay();
  expect(syncs()).toBe(1);
});

it("every new Today read syncs, and the reminders follow it", async () => {
  useHealthStore.setState({ today: today([{ id: 's', scheduledFor: '2026-09-21', kind: 'strength', title: 'Legs', minutes: 30, status: 'planned' }]) });
  await afterDelay();
  expect(syncs()).toBe(1);
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    'health.weeklycheckin',
    'health.workoutday.2026-09-21',
  ]);

  // Something else in the health store changing is not a new read.
  useHealthStore.setState({ cachedAt: new Date() });
  await afterDelay();
  expect(syncs()).toBe(1);
});

it('a consent change syncs, and the reminders go with the consent', async () => {
  useHealthStore.setState({ today: today([{ id: 's', scheduledFor: '2026-09-21', kind: 'strength', title: 'Legs', minutes: 30, status: 'planned' }]) });
  await afterDelay();
  expect(notificationsState.scheduled()).toHaveLength(2);

  useAppStore.setState({ profile: profile(false) });
  await afterDelay();
  expect(syncs()).toBe(2);
  expect(notificationsState.scheduled()).toEqual([]);
});

it('a membership change syncs', async () => {
  useAppStore.setState({ profile: decodeProfile({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false, health: { access: 'pass_only', consent: { version: '2026-09-v1' } } }) });
  await afterDelay();
  expect(syncs()).toBe(1);
});

it('each activation syncs (no Today read in flight)', async () => {
  const hook = mockHooks.activation['notifications.health-reminders'];
  expect(hook).toBeDefined();
  await hook!({ memberId: MEMBER, trigger: 'foreground' });
  await afterDelay();
  expect(syncs()).toBe(1);
});

it("an activation while the health layer's Today read is in flight syncs once, after the read lands, from what it brought", async () => {
  const hook = mockHooks.activation['notifications.health-reminders']!;
  // F7's `health.activate` started the read alongside this module's hook.
  useHealthStore.setState({ loadState: { kind: 'loading' } });
  await hook({ memberId: MEMBER, trigger: 'foreground' });
  await afterDelay();
  // The sync came due, read the permission and stopped before planning.
  expect(syncs()).toBe(1);
  expect(notificationsState.scheduled()).toEqual([]);

  // The read lands: today, then the load state, as the store sets them.
  useHealthStore.setState({ today: today([{ id: 's', scheduledFor: '2026-09-21', kind: 'strength', title: 'Legs', minutes: 30, status: 'planned' }]) });
  useHealthStore.setState({ loadState: { kind: 'loaded', at: new Date() } });
  await afterDelay();
  expect(syncs()).toBe(2);
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    'health.weeklycheckin',
    'health.workoutday.2026-09-21',
  ]);
});

it('a Today read that fails still syncs once it settles, from the day the store already had (as iOS syncs after the read whatever its outcome)', async () => {
  useHealthStore.setState({ today: today([{ id: 's', scheduledFor: '2026-09-21', kind: 'strength', title: 'Legs', minutes: 30, status: 'planned' }]) });
  useHealthStore.setState({ loadState: { kind: 'loading' } });
  await afterDelay();
  expect(notificationsState.scheduled()).toEqual([]);

  useHealthStore.setState({ loadState: { kind: 'failed', code: 'offline' } });
  await afterDelay();
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    'health.weeklycheckin',
    'health.workoutday.2026-09-21',
  ]);
});

it('a sign-out drops the sync still waiting', async () => {
  requestReminderSync();
  const cleaner = mockHooks.signOut['notifications.health-reminders'];
  expect(cleaner).toBeDefined();
  await cleaner!({ memberId: MEMBER });
  await afterDelay();
  expect(syncs()).toBe(0);
});
