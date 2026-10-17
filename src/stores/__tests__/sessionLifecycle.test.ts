/**
 * The session lifecycle through the app's real Supabase client against the
 * stub auth server: launch (iOS `AppState.checkSession`), sign-in, sign-out
 * and the auth listener.
 *
 * The case iOS fixed in 2.5.0 and the first Android build still had: an
 * offline cold start with an expired access token showed the sign-in screen,
 * although a refresh token was on the phone. Offline at the gym door is not
 * signed out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { api, Reply, supabase as authHost, type StubReply } from '@test/server';
import { setEnv } from '@test/harness';

import { stubApiClientPerTest } from '../../api/testing';
import { registerActivationHook, registerPreSignOutHook, registerSignOutCleaner } from '../../app/signOut';
import { COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY } from '../../features/coach/register';
import { readStoredSession } from '../../lib/secureSessionStorage';
import { supabase, SUPABASE_STORAGE_KEY } from '../../supabase/lib/client';
import {
  ACCOUNT_LANGUAGE_KEY,
  KENNITALA_PROMPT_DISMISSED_KEY,
  registerKennitalaPromptBlocker,
  useAppStore,
} from '../appStore';

import {
  freshStorePerTest,
  MEMBER_A,
  MEMBER_B,
  netInfo,
  PLUS_SUBSCRIPTION,
  profileJSON,
  sessionJSON,
  settle,
  storeSession,
} from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

const unregister: (() => void)[] = [];
afterEach(() => {
  while (unregister.length) unregister.pop()!();
});

// supabase-js logs every auth request that fails on the way (a refresh or a
// logout with no network) and a refused refresh: those are the cases under
// test here. Anything else still reaches the console.
const consoleError = console.error;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args.some((arg) => arg instanceof Error && /Failed to fetch|Invalid Refresh Token/.test(arg.message))) return;
    consoleError(...args);
  });
});
afterEach(() => {
  jest.mocked(console.error).mockRestore();
});

/**
 * The token endpoint, answering `failure` until `recover()`, then a fresh
 * session. A test that leaves supabase-js retrying a refresh recovers before
 * it ends, so its retries finish inside the test that started them.
 */
function refreshEndpoint(failure: () => StubReply, userId = MEMBER_A) {
  let up = false;
  authHost.on('POST', '/auth/v1/token', () =>
    up ? Reply.json(200, sessionJSON(userId, 7200, 'refresh-2')) : failure(),
  );
  return {
    async recover(): Promise<void> {
      up = true;
      await supabase.auth.getSession();
      await settle();
    },
  };
}

function serveMember(options: Parameters<typeof profileJSON>[0] = {}) {
  api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true, ...options })));
  api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
}

const ownerlessChats = JSON.stringify([{ id: 's-1', title: 'Pools near Laugardalur?', date: '2026-10-01', messages: [] }]);

describe('launch', () => {
  it('with no stored session the member is signed out and the launch screen goes', async () => {
    await store().bootstrap();
    expect(store().isAuthenticated).toBe(false);
    expect(store().isLoading).toBe(false);
    expect(api.requests).toHaveLength(0);
  });

  it('a stored session: signed in, the profile read before the launch screen goes, the plan alongside', async () => {
    await storeSession(MEMBER_A);
    let loadingDuringRead: boolean | null = null;
    api.on('GET', '/profile', () => {
      loadingDuringRead = store().isLoading;
      return Reply.ok(profileJSON({ kennitalaVerified: true, locale: 'is' }));
    });
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, ownerlessChats);

    const launch = store().bootstrap();
    expect(store().isLoading).toBe(true);
    await launch;
    await settle();

    expect(loadingDuringRead).toBe(true);
    expect(store().isLoading).toBe(false);
    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(store().session?.user.id).toBe(MEMBER_A);
    expect(store().profile?.id).toBe(MEMBER_A);
    expect(store().language).toBe('is');
    expect(store().subscriptionLoaded).toBe(true);
    // A restored session keeps the chats saved before chats had owners.
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBe(ownerlessChats);
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBe(MEMBER_A);
  });

  it('runs once, however many screens ask', async () => {
    const first = store().bootstrap();
    expect(store().bootstrap()).toBe(first);
    await first;
  });

  it('offline with an expired token, the member stays signed in on the stored session', async () => {
    await storeSession(MEMBER_A, -60);
    await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, 'is');
    netInfo({ isConnected: false, isInternetReachable: false });
    const endpoint = refreshEndpoint(() => Reply.fail());
    api.on('GET', '/profile', Reply.fail());
    api.on('GET', '/subscriptions', Reply.fail());

    const started = Date.now();
    await store().bootstrap();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(store().isLoading).toBe(false);
    expect(store().profile).toBeNull();
    // The cached account language keeps an Icelandic member in Icelandic at the door.
    expect(store().language).toBe('is');

    netInfo({ isConnected: true, isInternetReachable: true });
    await endpoint.recover();
  });

  it('online with the auth server out of reach, the first failed refresh decides: signed in, not after 30 s', async () => {
    await storeSession(MEMBER_A, -60);
    const endpoint = refreshEndpoint(() => Reply.fail());
    serveMember();

    const started = Date.now();
    await store().bootstrap();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(store().isAuthenticated).toBe(true);
    expect(store().profile?.id).toBe(MEMBER_A);

    // When the auth server comes back the SDK's own retry refreshes, and the store follows.
    await endpoint.recover();
    expect(store().session?.refresh_token).toBe('refresh-2');
    expect(store().isAuthenticated).toBe(true);
  });

  it('a refresh the auth server refuses at launch is signed out', async () => {
    await storeSession(MEMBER_A, -60);
    authHost.on(
      'POST',
      '/auth/v1/token',
      Reply.json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }),
    );
    await store().bootstrap();
    await settle();
    expect(store().isAuthenticated).toBe(false);
    expect(await readStoredSession(SUPABASE_STORAGE_KEY)).toBeNull();
    expect(api.requests).toHaveLength(0);
  });

  it('the activation hooks run once the member has a profile, and again on each return to the foreground', async () => {
    const seen: string[] = [];
    unregister.push(registerActivationHook('test.activation', ({ trigger, memberId }) => void seen.push(`${trigger}:${memberId}`)));
    await storeSession(MEMBER_A);
    serveMember();
    await store().bootstrap();
    await store().loadProfile();
    expect(seen).toEqual([`profile:${MEMBER_A}`]);

    const onChange = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1] as (state: string) => void;
    const start = jest.spyOn(supabase.auth, 'startAutoRefresh').mockResolvedValue();
    const stop = jest.spyOn(supabase.auth, 'stopAutoRefresh').mockResolvedValue();
    onChange('background');
    expect(stop).toHaveBeenCalled();
    onChange('active');
    expect(start).toHaveBeenCalled();
    await settle();
    expect(seen).toEqual([`profile:${MEMBER_A}`, `foreground:${MEMBER_A}`]);
    start.mockRestore();
    stop.mockRestore();
  });

  it('a development fixture stands the app up signed in, with no network', async () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=pass-holder,language=is' });
    await store().bootstrap();
    expect(store().isAuthenticated).toBe(true);
    expect(store().profile?.usage?.passes[0]?.type).toBe('adventurer');
    expect(store().language).toBe('is');
    expect(store().healthAccess).toBe('pass_only');
    expect(api.requests).toHaveLength(0);
    expect(authHost.requests).toHaveLength(0);
  });
});

describe('sign-in', () => {
  it("a sign-in the screens did not announce (the first build's sign-in, an auth link) still signs the member in", async () => {
    await store().bootstrap();
    serveMember();
    await AsyncStorage.setItem(COACH_SESSIONS_KEY, ownerlessChats);
    authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
    const session = sessionJSON(MEMBER_A, 3600);
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await settle(10);
    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(store().profile?.id).toBe(MEMBER_A);
    // A fresh sign-in never inherits chats nobody owned.
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
  });

  it('a sign-in that lands while launch is still deciding (an auth link that opened the app) is not lost', async () => {
    serveMember();
    authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
    // Launch waits on the network check while the link's session arrives.
    let connected!: () => void;
    jest.mocked(NetInfo.fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          connected = () => resolve({ type: 'wifi', isConnected: true, isInternetReachable: true, details: null } as never);
        }),
    );
    const launch = store().bootstrap();
    await settle();
    const session = sessionJSON(MEMBER_A, 3600);
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await settle();
    connected();
    await launch;
    await settle(10);
    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
  });

  it('an announced sign-in and its SIGNED_IN are one sign-in', async () => {
    await store().bootstrap();
    serveMember();
    authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
    const session = sessionJSON(MEMBER_A, 3600);
    const { data } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await store().handleSignIn(MEMBER_A, { session: data.session });
    await settle(10);
    expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
    expect(store().session?.access_token).toBe(session.access_token);
  });

  it("another member signing in never sees the last member's profile", async () => {
    serveMember({ fullName: 'Anna' });
    await store().handleSignIn(MEMBER_A);
    expect(store().profile?.fullName).toBe('Anna');
    let profileWhileB: unknown = 'unread';
    api.on('GET', '/profile', () => {
      profileWhileB = store().profile;
      return Reply.ok(profileJSON({ id: MEMBER_B, fullName: 'Björn', kennitalaVerified: true }));
    });
    await store().handleSignIn(MEMBER_B);
    expect(profileWhileB).toBeNull();
    expect(store().profile?.fullName).toBe('Björn');
  });

  describe('the Kenni nudge (fresh, unverified accounts only)', () => {
    const fresh = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

    it('arms for a fresh unverified account', async () => {
      serveMember({ kennitalaVerified: false, createdAt: fresh() });
      await store().handleSignIn(MEMBER_A);
      expect(store().pendingKennitalaPrompt).toBe(true);
      await store().dismissKennitalaPrompt();
      expect(store().pendingKennitalaPrompt).toBe(false);
      expect(await AsyncStorage.getItem(KENNITALA_PROMPT_DISMISSED_KEY)).toBe('true');
    });

    it('never after it was closed once on this phone', async () => {
      await AsyncStorage.setItem(KENNITALA_PROMPT_DISMISSED_KEY, 'true');
      serveMember({ kennitalaVerified: false, createdAt: fresh() });
      await store().handleSignIn(MEMBER_A);
      expect(store().pendingKennitalaPrompt).toBe(false);
    });

    it('not for a password-recovery sign-in, even when its SIGNED_IN came first', async () => {
      serveMember({ kennitalaVerified: false, createdAt: fresh() });
      const first = store().handleSignIn(MEMBER_A);
      const recovery = store().handleSignIn(MEMBER_A, { suppressKennitalaPrompt: true });
      await Promise.all([first, recovery]);
      expect(store().pendingKennitalaPrompt).toBe(false);
    });

    it('not for a verified, an older, or a dated-nowhere account', async () => {
      for (const options of [
        { kennitalaVerified: true, createdAt: fresh() },
        { kennitalaVerified: false, createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() },
        { kennitalaVerified: false },
      ]) {
        serveMember(options);
        await store().handleSignIn(MEMBER_A);
        expect(store().pendingKennitalaPrompt).toBe(false);
        await store().handleSignOut();
      }
    });

    it('not while a check-in link is in play this session', async () => {
      unregister.push(registerKennitalaPromptBlocker(() => true));
      serveMember({ kennitalaVerified: false, createdAt: fresh() });
      await store().handleSignIn(MEMBER_A);
      expect(store().pendingKennitalaPrompt).toBe(false);
    });
  });
});

describe('sign-out', () => {
  async function signedIn(): Promise<void> {
    await storeSession(MEMBER_A);
    serveMember();
    await store().bootstrap();
  }

  it('SIGNED_OUT runs handleSignOut exactly once', async () => {
    await signedIn();
    let runs = 0;
    unregister.push(registerSignOutCleaner('test.count', () => void (runs += 1)));
    authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
    await store().signOut();
    await settle(10);
    expect(runs).toBe(1);
    expect(store().isAuthenticated).toBe(false);
    expect(store().profile).toBeNull();
    expect(await readStoredSession(SUPABASE_STORAGE_KEY)).toBeNull();
  });

  it('a session ended elsewhere (a refused refresh, a revoked token) runs it once too', async () => {
    await signedIn();
    let runs = 0;
    unregister.push(registerSignOutCleaner('test.count', () => void (runs += 1)));
    authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
    await supabase.auth.signOut({ scope: 'local' });
    await settle(10);
    expect(runs).toBe(1);
    expect(store().isAuthenticated).toBe(false);
  });

  it('an offline sign-out still ends the session on this phone', async () => {
    await signedIn();
    const seen: (string | null)[] = [];
    unregister.push(registerSignOutCleaner('test.member', ({ memberId }) => void seen.push(memberId)));
    netInfo({ isConnected: false, isInternetReachable: false });
    authHost.on('POST', '/auth/v1/logout', Reply.fail());
    await store().signOut();
    await settle(10);
    expect(store().isAuthenticated).toBe(false);
    expect(await readStoredSession(SUPABASE_STORAGE_KEY)).toBeNull();
    expect(seen).toEqual([MEMBER_A]);
  });

  it('an auth server that fails the logout still signs out', async () => {
    await signedIn();
    authHost.on('POST', '/auth/v1/logout', Reply.json(500, { code: 500, error_code: 'unexpected_failure', msg: 'boom' }));
    await store().signOut();
    await settle(10);
    expect(store().isAuthenticated).toBe(false);
    expect(await readStoredSession(SUPABASE_STORAGE_KEY)).toBeNull();
  });

  it('the pre-sign-out hooks run while the session still stands', async () => {
    await signedIn();
    let sessionDuringHook: unknown = null;
    unregister.push(
      registerPreSignOutHook('test.foodOff', async ({ memberId }) => {
        sessionDuringHook = memberId && (await readStoredSession(SUPABASE_STORAGE_KEY))?.user.id;
      }),
    );
    authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
    await store().signOut();
    expect(sessionDuringHook).toBe(MEMBER_A);
  });

  it("an answer that arrives after the member left is dropped", async () => {
    await signedIn();
    api.on('GET', '/profile', Reply.delayed(50, Reply.ok(profileJSON({ fullName: 'Late' }))));
    const late = store().loadProfile();
    await store().handleSignOut();
    await late;
    expect(store().profile).toBeNull();
  });

  it('a changed user re-reads the profile', async () => {
    await signedIn();
    const before = api.sentAll('/profile', 'GET').length;
    authHost.on('PUT', '/auth/v1/user', Reply.json(200, { ...sessionJSON(MEMBER_A, 3600).user, user_metadata: { full_name: 'Anna' } }));
    await supabase.auth.updateUser({ data: { full_name: 'Anna' } });
    await settle(10);
    expect(api.sentAll('/profile', 'GET').length).toBe(before + 1);
  });
});
