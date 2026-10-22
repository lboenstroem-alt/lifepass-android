/**
 * What sets the engagement sync off (iOS `ContentView`): launch ending, every
 * return to the foreground once launch is done, and the purchase state
 * changing (the plan read answering, a membership gained or lost, the first
 * pass or the last one). Plus the Android case: the profile arriving after
 * the plan read, which is when a sign-in's purchase state becomes known.
 *
 * Its own file: the wiring subscribes to the store and AppState for the
 * life of the module.
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import { decodeProfile, type Profile, type Usage } from '../../api/profile';
import type { Subscription } from '../../api/subscriptions';
import type * as SignOut from '../../app/signOut';
import { resetHealthStoreForTests } from '../../health/store';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { ENGAGEMENT_IDS, installEngagementNudges, resetEngagementForTests } from '../engagement';

const mockCleaners: Record<string, SignOut.SignOutCleaner> = {};

// Only this module's sign-out cleaner, captured: the real registry would load
// every package's register file and run their cleaners too.
jest.mock('../../app/signOut', () => ({
  ...jest.requireActual<typeof SignOut>('../../app/signOut'),
  registerSignOutCleaner: (id: string, cleaner: SignOut.SignOutCleaner) => {
    mockCleaners[id] = cleaner;
    return () => undefined;
  },
}));

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

const realSetImmediate = globalThis.setImmediate;
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => realSetImmediate(resolve));
}

/** The AppState listener the wiring added, kept from the one install (calls are cleared after each test). */
let appStateListener: ((state: AppStateStatus) => void) | null = null;
function wire(): (state: AppStateStatus) => void {
  installEngagementNudges();
  if (appStateListener === null) {
    const call = (AppState.addEventListener as jest.Mock).mock.calls.find(([event]) => event === 'change');
    appStateListener = call?.[1] ?? null;
  }
  if (appStateListener === null) throw new Error('no AppState listener');
  return appStateListener;
}

const syncs = () => (Notifications.getPermissionsAsync as jest.Mock).mock.calls.length;

function profile(passes: Usage['passes'] = []): Profile {
  const decoded = decodeProfile({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false });
  return {
    ...decoded,
    usage: {
      tier: null,
      network: null,
      pools: null,
      daily: null,
      concurrent: { open: 0, cap: null },
      topup: { available: false, prices: { gym: null, studio: null, pool: null } },
      passes,
      block: { until: null },
      strikes: { active: 0, threshold: 3 },
    },
  };
}

const SUBSCRIPTION: Subscription = {
  id: 'sub-1',
  productSlug: 'plus',
  productName: 'Plus',
  status: 'active',
  currentPeriodStartsAt: new Date('2026-10-01T00:00:00Z'),
  currentPeriodEndsAt: new Date('2026-11-01T00:00:00Z'),
  cancelAtPeriodEnd: false,
  cancelledAt: null,
};

let foreground: (state: AppStateStatus) => void;

beforeEach(async () => {
  foreground = wire();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  await settle();
  resetEngagementForTests();
  (Notifications.getPermissionsAsync as jest.Mock).mockClear();
  notificationsState.setPermission('granted');
});

it('launch ending is a sync, with everything launch read; changes during launch wait for it', async () => {
  useAppStore.setState({ isLoading: true, isAuthenticated: true, userId: MEMBER, profile: profile() });
  useAppStore.setState({ subscriptionLoaded: true, subscription: SUBSCRIPTION });
  await settle();
  expect(syncs()).toBe(0);

  useAppStore.setState({ isLoading: false });
  await settle();
  expect(syncs()).toBe(1);
  expect(notificationsState.scheduled().map((r) => r.identifier)).toEqual([ENGAGEMENT_IDS.stayActive]);
});

it('every return to the foreground once launch is done', async () => {
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: MEMBER, profile: profile(), subscriptionLoaded: true });
  await settle();
  const before = syncs();
  foreground('active');
  await settle();
  expect(syncs()).toBe(before + 1);
  foreground('background');
  await settle();
  expect(syncs()).toBe(before + 1);

  useAppStore.setState({ isLoading: true });
  await settle();
  foreground('active');
  await settle();
  expect(syncs()).toBe(before + 1);
});

it('the purchase state changing: the plan read, a membership, the first or last pass', async () => {
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: MEMBER, profile: profile() });
  await settle();
  let count = syncs();

  useAppStore.setState({ subscriptionLoaded: true });
  await settle();
  expect(syncs()).toBe(++count);

  useAppStore.setState({ subscription: SUBSCRIPTION });
  await settle();
  expect(syncs()).toBe(++count);
  expect(notificationsState.scheduled().map((r) => r.identifier)).toEqual([ENGAGEMENT_IDS.stayActive]);

  useAppStore.setState({ subscription: null });
  await settle();
  expect(syncs()).toBe(++count);

  const pass = { id: 'pass-1', type: 'explorer', visitsLeft: 3, expiresAt: new Date('2026-10-30T00:00:00Z') };
  useAppStore.setState({ profile: profile([pass]) });
  await settle();
  expect(syncs()).toBe(++count);

  // A second pass changes nothing the nudges read.
  useAppStore.setState({ profile: profile([pass, { ...pass, id: 'pass-2' }]) });
  await settle();
  expect(syncs()).toBe(count);
});

it('the profile arriving after the plan read is when a sign-in can decide: a sync, and the prompt', async () => {
  notificationsState.setPermission('undetermined');
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: MEMBER, profile: null, subscriptionLoaded: true });
  await settle();
  expect(notificationsState.requestCount()).toBe(0);

  useAppStore.setState({ profile: profile() });
  await settle();
  expect(notificationsState.requestCount()).toBe(1);
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    ENGAGEMENT_IDS.noPurchaseDay12,
    ENGAGEMENT_IDS.noPurchaseDay5,
  ]);
});

it('a change the nudges do not read sets nothing off', async () => {
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: MEMBER, profile: profile(), subscriptionLoaded: true });
  await settle();
  const before = syncs();
  useAppStore.setState({ profileReadAt: new Date() });
  await settle();
  expect(syncs()).toBe(before);
});

it("a sign-out takes the member's own nudges off (their visits never reach the next person's lock screen)", async () => {
  const lane = { used: 1, cap: 8, resetsAt: new Date(Date.now() + 20 * 24 * 3600 * 1000) };
  const subscriber = { ...profile(), usage: { ...profile().usage!, tier: 'plus', network: lane } };
  useAppStore.setState({
    isLoading: false,
    isAuthenticated: true,
    userId: MEMBER,
    profile: subscriber,
    subscription: SUBSCRIPTION,
    subscriptionLoaded: true,
  });
  await settle();
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    ENGAGEMENT_IDS.stayActive,
    ENGAGEMENT_IDS.visitsReset,
  ]);

  // What the store's sign-out sets.
  useAppStore.setState({ isAuthenticated: false, userId: null, profile: null, subscription: null, subscriptionLoaded: false });
  await settle();
  const left = notificationsState.scheduled().map((r) => r.identifier);
  expect(left).not.toContain(ENGAGEMENT_IDS.stayActive);
  expect(left).not.toContain(ENGAGEMENT_IDS.visitsReset);
});

it("notifications refused in system settings: the sign-out still takes the member's own nudges off, the phone's ladder stays", async () => {
  const lane = { used: 1, cap: 8, resetsAt: new Date(Date.now() + 20 * 24 * 3600 * 1000) };
  const subscriber = { ...profile(), usage: { ...profile().usage!, tier: 'plus', network: lane } };
  useAppStore.setState({
    isLoading: false,
    isAuthenticated: true,
    userId: MEMBER,
    profile: subscriber,
    subscription: SUBSCRIPTION,
    subscriptionLoaded: true,
  });
  await settle();
  expect(notificationsState.scheduled().map((r) => r.identifier).sort()).toEqual([
    ENGAGEMENT_IDS.stayActive,
    ENGAGEMENT_IDS.visitsReset,
  ]);
  // One of them already in the shade, and a ladder rung from before the purchase.
  await notificationsState.fire(ENGAGEMENT_IDS.visitsReset);
  await Notifications.scheduleNotificationAsync({
    identifier: ENGAGEMENT_IDS.noPurchaseDay12,
    content: { title: 'x', body: 'y' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 3 * 24 * 3600 * 1000) },
  });

  // The member turns LifePass notifications off in system settings, then signs out.
  notificationsState.setPermission('denied');
  const cleaner = mockCleaners['notifications.engagement'];
  expect(cleaner).toBeDefined();
  useAppStore.setState({ isAuthenticated: false, userId: null, profile: null, subscription: null, subscriptionLoaded: false });
  await cleaner!({ memberId: MEMBER });
  await settle();

  const left = [
    ...notificationsState.scheduled().map((r) => r.identifier),
    ...notificationsState.presented().map((n) => n.request.identifier),
  ];
  expect(left).toEqual([ENGAGEMENT_IDS.noPurchaseDay12]);
});
