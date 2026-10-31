/**
 * The set-new-password screen outlives the process (./recovery.ts, Android):
 * written down when a reset link raises it, brought back when launch
 * restores that same member's session within the hour, and forgotten on
 * "Later", a changed password, a sign-out, another member's sign-in or a
 * fresh sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, Reply } from '@test/server';

import { runSignOutCleaners } from '../../../app/signOut';
import { stubApiClientPerTest } from '../../../api/testing';
import {
  freshStorePerTest,
  MEMBER_A,
  MEMBER_B,
  PLUS_SUBSCRIPTION,
  profileJSON,
  settle,
  storeSession,
} from '../../../stores/__tests__/storeHarness';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../supabase/lib/client';
import {
  beginPasswordRecovery,
  endPasswordRecovery,
  RECOVERY_PENDING_KEY,
  RECOVERY_PENDING_TTL_MS,
  resumePasswordRecovery,
} from '../recovery';

stubApiClientPerTest();
freshStorePerTest();

afterEach(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

const store = () => useAppStore.getState();
const NOW = 1_800_000_000_000;

async function storedMark(): Promise<{ userId: string; at: number } | null> {
  return JSON.parse((await AsyncStorage.getItem(RECOVERY_PENDING_KEY)) ?? 'null') as { userId: string; at: number } | null;
}

async function markScreenUp(userId: string, at: number): Promise<void> {
  await AsyncStorage.setItem(RECOVERY_PENDING_KEY, JSON.stringify({ userId, at }));
}

it('a reset link raising the screen writes down whose it is and when', async () => {
  beginPasswordRecovery(MEMBER_A.toUpperCase(), () => NOW);
  await settle();
  expect(store().pendingPasswordRecovery).toBe(true);
  expect(await storedMark()).toEqual({ userId: MEMBER_A, at: NOW });
});

it('"Later" (or the alert after a change) forgets it', async () => {
  beginPasswordRecovery(MEMBER_A, () => NOW);
  await settle();
  endPasswordRecovery();
  await settle();
  expect(store().pendingPasswordRecovery).toBe(false);
  expect(await storedMark()).toBeNull();
});

it('a sign-out forgets it', async () => {
  beginPasswordRecovery(MEMBER_A, () => NOW);
  await settle();
  await runSignOutCleaners({ memberId: MEMBER_A });
  expect(store().pendingPasswordRecovery).toBe(false);
  expect(await storedMark()).toBeNull();
});

describe('when a session is signed in', () => {
  it('a launch restoring the same member within the hour brings the screen back, nudge held off', async () => {
    await markScreenUp(MEMBER_A, NOW - 10 * 60 * 1000);
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await resumePasswordRecovery({ userId: MEMBER_A, restoredSession: true }, () => NOW);
    expect(store().pendingPasswordRecovery).toBe(true);
    expect(store().pendingKennitalaPrompt).toBe(false);
    // The mark keeps its time: an hour from the link at most.
    expect(await storedMark()).toEqual({ userId: MEMBER_A, at: NOW - 10 * 60 * 1000 });
  });

  it('another member: no screen, and the mark is dropped', async () => {
    await markScreenUp(MEMBER_A, NOW - 60 * 1000);
    await resumePasswordRecovery({ userId: MEMBER_B, restoredSession: true }, () => NOW);
    expect(store().pendingPasswordRecovery).toBe(false);
    expect(await storedMark()).toBeNull();
  });

  it('an hour on: no screen, and the mark is dropped', async () => {
    await markScreenUp(MEMBER_A, NOW - RECOVERY_PENDING_TTL_MS);
    await resumePasswordRecovery({ userId: MEMBER_A, restoredSession: true }, () => NOW);
    expect(store().pendingPasswordRecovery).toBe(false);
    expect(await storedMark()).toBeNull();
  });

  it('a fresh sign-in (a password, not the link): no screen, and the mark is dropped', async () => {
    await markScreenUp(MEMBER_A, NOW - 60 * 1000);
    await resumePasswordRecovery({ userId: MEMBER_A, restoredSession: false }, () => NOW);
    expect(store().pendingPasswordRecovery).toBe(false);
    expect(await storedMark()).toBeNull();
  });

  it("the reset link's own sign-in keeps it (its screen is already up)", async () => {
    beginPasswordRecovery(MEMBER_A, () => NOW);
    await settle();
    await resumePasswordRecovery({ userId: MEMBER_A, restoredSession: false }, () => NOW + 1000);
    expect(store().pendingPasswordRecovery).toBe(true);
    expect(await storedMark()).toEqual({ userId: MEMBER_A, at: NOW });
  });

  it('a damaged mark is ignored', async () => {
    await AsyncStorage.setItem(RECOVERY_PENDING_KEY, '{not json');
    await resumePasswordRecovery({ userId: MEMBER_A, restoredSession: true }, () => NOW);
    expect(store().pendingPasswordRecovery).toBe(false);
  });

  it('storage that fails shows nothing and throws nothing', async () => {
    // Once only. No mockRestore: the storage mock's getItem is itself a jest.fn, and restoring it would empty it.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(resumePasswordRecovery({ userId: MEMBER_A, restoredSession: true }, () => NOW)).resolves.toBeUndefined();
    expect(store().pendingPasswordRecovery).toBe(false);
  });
});

it('end to end: Android dropped the app on set-new-password; the next launch shows it again', async () => {
  // A fresh unverified account, so the launch would arm the Kenni nudge if nothing held it back.
  api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: false, createdAt: new Date().toISOString() })));
  api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
  await storeSession(MEMBER_A);
  await markScreenUp(MEMBER_A, Date.now() - 5 * 60 * 1000);

  await store().bootstrap();
  await settle();

  expect(store().isAuthenticated).toBe(true);
  expect(store().pendingPasswordRecovery).toBe(true);
  expect(store().pendingKennitalaPrompt).toBe(false);
});
