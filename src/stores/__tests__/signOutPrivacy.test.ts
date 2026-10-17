/**
 * What a member leaves on the phone when they sign out: the port of iOS
 * SignOutPrivacyTests (the Coach's saved chats and the wipe's member id; the
 * health wipe itself is F7's, through the same registry).
 *
 * Two gaps iOS closed in 2.5.0, both present in the first Android build: the
 * Coach's saved chats sat in one device-wide key, so the next account on the
 * phone saw them and could send them under its own name; and a wipe keyed on
 * the profile ran only when the profile had loaded, so signing out after an
 * offline cold start left the member's data behind.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { stubApiClientPerTest } from '../../api/testing';
import {
  onSignedOut,
  PRE_SIGN_OUT_BUDGET_MS,
  registeredHookIds,
  registerPreSignOutHook,
  registerSignInHook,
  registerSignOutCleaner,
  runPreSignOutHooks,
  runSignInHooks,
} from '../../app/signOut';
import { REGISTERED_FEATURE_AREAS } from '../../app/registrations';
import { COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY } from '../../features/coach/register';
import { decodeProfile } from '../../api/profile';
import { ACCOUNT_LANGUAGE_KEY, useAppStore } from '../appStore';

import { freshStorePerTest, MEMBER_A, MEMBER_B, profileJSON } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

const unregister: (() => void)[] = [];
afterEach(() => {
  while (unregister.length) unregister.pop()!();
});

/** One saved chat, the way the Coach saves it. */
async function saveAChat(): Promise<void> {
  await AsyncStorage.setItem(
    COACH_SESSIONS_KEY,
    JSON.stringify([{ id: 's-1', title: 'Pools near Laugardalur?', date: '2026-10-01T10:00:00Z', messages: [] }]),
  );
}

async function savedChats(): Promise<number> {
  const raw = await AsyncStorage.getItem(COACH_SESSIONS_KEY);
  return raw ? (JSON.parse(raw) as unknown[]).length : 0;
}

describe("the Coach's saved chats", () => {
  it('sign-out deletes them', async () => {
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    await saveAChat();
    expect(await savedChats()).toBe(1);
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
    await store().handleSignOut();
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBeNull();
  });

  it("the next account never sees the first account's chats", async () => {
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    await saveAChat();
    // Member B signs in without A ever signing out (A's session expired).
    await runSignInHooks({ userId: MEMBER_B, restoredSession: false });
    expect(await savedChats()).toBe(0);
  });

  it('the same member keeps theirs', async () => {
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    await saveAChat();
    await runSignInHooks({ userId: MEMBER_A.toUpperCase(), restoredSession: true });
    expect(await savedChats()).toBe(1);
  });

  it('chats with no owner go to a restored session only', async () => {
    await saveAChat();
    await runSignInHooks({ userId: MEMBER_A, restoredSession: true });
    expect(await savedChats()).toBe(1);

    await AsyncStorage.multiRemove([COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY]);
    await saveAChat();
    await runSignInHooks({ userId: MEMBER_B, restoredSession: false });
    expect(await savedChats()).toBe(0);
  });

  it('a Coach screen still open hears that the member signed out', async () => {
    const heard: (string | null)[] = [];
    unregister.push(onSignedOut(({ memberId }) => heard.push(memberId)));
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
    await store().handleSignOut();
    expect(heard).toEqual([MEMBER_A]);
  });
});

describe('the wipe', () => {
  it('runs with the session user id even when the profile never loaded', async () => {
    const wiped: (string | null)[] = [];
    unregister.push(registerSignOutCleaner('test.health', ({ memberId }) => void wiped.push(memberId)));
    // An offline cold start: a session, no profile.
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A, profile: null });
    await store().handleSignOut();
    expect(wiped).toEqual([MEMBER_A]);
  });

  it("names the profile's member when the profile is in hand", async () => {
    const wiped: (string | null)[] = [];
    unregister.push(registerSignOutCleaner('test.health', ({ memberId }) => void wiped.push(memberId)));
    useAppStore.setState({ isAuthenticated: true, userId: null, profile: decodeProfile(profileJSON({ id: MEMBER_B })) });
    await store().handleSignOut();
    expect(wiped).toEqual([MEMBER_B]);
  });

  it('with nothing to name the member, the cleaners still run', async () => {
    const wiped: (string | null)[] = [];
    unregister.push(registerSignOutCleaner('test.health', ({ memberId }) => void wiped.push(memberId)));
    await store().handleSignOut();
    expect(wiped).toEqual([null]);
  });

  it('a cleaner that fails does not stop the others', async () => {
    const ran: string[] = [];
    unregister.push(registerSignOutCleaner('test.broken', () => Promise.reject(new Error('disk'))));
    unregister.push(
      registerSignOutCleaner('test.throws', () => {
        throw new Error('bug');
      }),
    );
    unregister.push(registerSignOutCleaner('test.fine', () => void ran.push('fine')));
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
    await expect(store().handleSignOut()).resolves.toBeUndefined();
    expect(ran).toEqual(['fine']);
  });

  it('clears the member from the app state, and forgets the account language and the pending nudge', async () => {
    await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, 'is');
    useAppStore.setState({
      isAuthenticated: true,
      userId: MEMBER_A,
      profile: decodeProfile(profileJSON()),
      profileReadAt: new Date(),
      subscriptionLoaded: true,
      cachedAccountLanguage: 'is',
      pendingKennitalaPrompt: true,
      healthAccessOverride: 'pass_only',
    });
    await store().handleSignOut();
    const state = store();
    expect(state.isAuthenticated).toBe(false);
    expect(state.userId).toBeNull();
    expect(state.session).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.profileReadAt).toBeNull();
    expect(state.subscription).toBeNull();
    expect(state.subscriptionLoaded).toBe(false);
    expect(state.cachedAccountLanguage).toBeNull();
    expect(state.pendingKennitalaPrompt).toBe(false);
    expect(state.healthAccessOverride).toBeNull();
    expect(await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY)).toBeNull();
  });
});

describe('the registry', () => {
  it('a hook registered twice under one id runs once (the newest)', async () => {
    const seen: string[] = [];
    unregister.push(registerSignInHook('test.twice', () => void seen.push('old')));
    unregister.push(registerSignInHook('test.twice', () => void seen.push('new')));
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    expect(seen).toEqual(['new']);
  });

  it('the pre-sign-out hooks get a short try, and the sign-out goes ahead after it', async () => {
    jest.useFakeTimers();
    try {
      let finished = false;
      unregister.push(registerPreSignOutHook('test.slow', () => new Promise<void>(() => undefined)));
      const run = runPreSignOutHooks({ memberId: MEMBER_A }).then(() => {
        finished = true;
      });
      await jest.advanceTimersByTimeAsync(PRE_SIGN_OUT_BUDGET_MS - 1);
      expect(finished).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await run;
      expect(finished).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('every register file under src/features is loaded at startup', () => {
    const features = join(__dirname, '..', '..', 'features');
    const onDisk = readdirSync(features).filter((area) => existsSync(join(features, area, 'register.ts')));
    expect([...REGISTERED_FEATURE_AREAS].sort()).toEqual(onDisk.sort());
  });

  it('every feature area has its register file loaded, and the Coach claims and forgets its chats', () => {
    expect(REGISTERED_FEATURE_AREAS).toContain('coach');
    expect(REGISTERED_FEATURE_AREAS).not.toContain('healthConnect');
    const ids = registeredHookIds();
    expect(ids.signIn).toContain('coach.sessions');
    expect(ids.signOut).toContain('coach.sessions');
  });
});
