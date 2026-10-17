/**
 * What a member leaves on the phone when they sign out: the health half of
 * the iOS SignOutPrivacyTests, through the app store's real sign-out and the
 * registered cleaner (src/health/register.ts).
 *
 * The gap iOS closed in 2.5.0, present in the first Android build: the local
 * health wipe ran only when the profile had loaded, so signing out after an
 * offline cold start (or a failed GET /profile) left the cached day, the
 * outboxes and the reminders behind.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { decodeProfile } from '../../api/profile';
import { registeredHookIds, runActivationHooks } from '../../app/signOut';
import { scheduleAt } from '../../notifications';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { FeedbackKeys, ReminderKeys, WearableKeys } from '../localKeys';
import * as localStore from '../localStore';
import { resetHealthStoreForTests, useHealthStore } from '../store';
import { registerHealthWipeHook, type HealthWipeContext } from '../wipe';

stubApiClientPerTest();

const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
});

afterEach(async () => {
  resetAppStoreForTests();
  await localStore.settled();
});

it('the health wipe, the reconcile and the activation read are registered with the session hooks', () => {
  const ids = registeredHookIds();
  expect(ids.signOut).toContain('health.wipe');
  expect(ids.profileRead).toContain('health.reconcile');
  expect(ids.activation).toContain('health.activate');
});

it('sign-out wipes health state even when the profile never loaded', async () => {
  await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER_A), '1');
  await AsyncStorage.setItem(WearableKeys.connectedProfileId, MEMBER_A);
  fileSystemState.seed(`health/${MEMBER_A}/outbox.json`, '[]');

  // An offline cold start: a session, no profile.
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile: null });
  await useAppStore.getState().handleSignOut();
  await localStore.settled();

  expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER_A))).toBeNull();
  expect(await AsyncStorage.getItem(WearableKeys.connectedProfileId)).toBeNull();
  expect(fileSystemState.files()).toEqual([]);
});

it('the wearable marker names the folder when nothing else does', async () => {
  await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER_B), '1');
  await AsyncStorage.setItem(WearableKeys.connectedProfileId, MEMBER_B);
  fileSystemState.seed(`health/${MEMBER_B}/today.json`, '{}');

  await useAppStore.getState().handleSignOut();
  await localStore.settled();

  expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER_B))).toBeNull();
  expect(await AsyncStorage.getItem(WearableKeys.connectedProfileId)).toBeNull();
  expect(fileSystemState.files()).toEqual([]);
});

it('the id the health store last knew names the folder when the sign-out names nobody', async () => {
  fileSystemState.seed(`health/${MEMBER_B}/today.json`, '{}');
  useHealthStore.setState({ profileId: MEMBER_B });
  await useAppStore.getState().handleSignOut();
  await localStore.settled();
  expect(fileSystemState.files()).toEqual([]);
});

it('with nobody to name, the health notifications and the feedback member still go', async () => {
  const later = new Date(Date.now() + 3_600_000);
  await scheduleAt('health.weeklycheckin', later, { title: 'a', body: 'b' }, 'health');
  await scheduleAt('engagement.stayactive', later, { title: 'a', body: 'b' }, 'engagement');
  await AsyncStorage.setItem(FeedbackKeys.lastProfileId, MEMBER_A);
  const seen: HealthWipeContext[] = [];
  const unregister = registerHealthWipeHook('test.seen', (context) => void seen.push(context));

  await useAppStore.getState().handleSignOut();
  unregister();

  expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual(['engagement.stayactive']);
  expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
  // The feedback summary and the Coach's health messages still go.
  expect(seen).toEqual([{ profileId: null, reason: 'signout' }]);
});

it("a sign-out of one member never touches another member's folder", async () => {
  fileSystemState.seed(`health/${MEMBER_A}/today.json`, '{}');
  fileSystemState.seed(`health/${MEMBER_B}/today.json`, '{}');
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  await useAppStore.getState().handleSignOut();
  await localStore.settled();
  expect(fileSystemState.files()).toEqual([`files/health/${MEMBER_B}/today.json`]);
});

it("the app store's profile read reconciles: tracking switched off on the web empties the phone", async () => {
  fileSystemState.seed(`health/${MEMBER_A}/outbox.json`, '[]');
  api.on(
    'GET',
    '/profile',
    Reply.ok({
      id: MEMBER_A,
      locale: 'en',
      kennitalaVerified: true,
      marketingConsent: false,
      health: { access: 'entitled', consent: null, features: [] },
    }),
  );
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  await useAppStore.getState().loadProfile();
  await localStore.settled();
  expect(fileSystemState.files()).toEqual([]);
  expect(useHealthStore.getState().toastKey).toBe('health.consent_off_elsewhere');
});

describe('activation', () => {
  function member(health: Record<string, unknown>) {
    return {
      id: MEMBER_A,
      locale: 'en',
      kennitalaVerified: true,
      marketingConsent: false,
      usage: null,
      health,
    };
  }

  it('reads today for a member with consent, entitled, with a live plan; for no one else', async () => {
    api.on('GET', '/health', Reply.ok({ date: '2026-10-17', today: '2026-10-17' }));
    const live = { access: 'entitled', consent: { version: '2026-09-v1' }, program: { id: 'p1', status: 'active' } };
    for (const [health, reads] of [
      [live, 1],
      [{ ...live, consent: null }, 0],
      [{ ...live, access: 'pass_only' }, 0],
      [{ ...live, program: { id: 'p1', status: 'completed' } }, 0],
    ] as const) {
      resetHealthStoreForTests();
      api.reset();
      api.on('GET', '/health', Reply.ok({ date: '2026-10-17', today: '2026-10-17' }));
      useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile: decodeProfile(member(health)) });
      await runActivationHooks({ memberId: MEMBER_A, trigger: 'foreground' });
      expect(api.sentAll('/health')).toHaveLength(reads);
    }
  });
});
