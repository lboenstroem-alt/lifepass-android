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
import {
  PROFILE_READ_HOOK_BUDGET_MS,
  registerActivationHook,
  registerPreSignOutHook,
  registerProfileReadHook,
  registerSignOutCleaner,
} from '../../app/signOut';
import { FIXTURE_PROFILE_ID } from '../../dev/fixtureSession';
import { COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY } from '../../features/coach/register';
import { readStoredSession } from '../../lib/secureSessionStorage';
import { supabase, SUPABASE_STORAGE_KEY } from '../../supabase/lib/client';
import {
  ACCOUNT_LANGUAGE_KEY,
  KENNITALA_PROMPT_DISMISSED_KEY,
  registerKennitalaPromptBlocker,
  selectPurchaseStateKnown,
  serverLogoutSettledForTests,
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

/** Settles until `check` holds, or gives up after enough turns for a sign-out round trip. */
async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 50 && !(await check()); i += 1) await settle(1);
}

const noStoredSession = async () => (await readStoredSession(SUPABASE_STORAGE_KEY)) === null;

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
    // No plan, and that is known (iOS treats the fixture's nil plan as read).
    expect(store().subscriptionLoaded).toBe(true);
    expect(selectPurchaseStateKnown(store())).toBe(true);
    expect(api.requests).toHaveLength(0);
    expect(authHost.requests).toHaveLength(0);
  });

  it('a real session the SDK signs in meanwhile does not replace the fixture member', async () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=pass-holder' });
    await store().bootstrap();
    authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_B, 3600).user));
    const real = sessionJSON(MEMBER_B, 3600);
    await supabase.auth.setSession({ access_token: real.access_token, refresh_token: real.refresh_token });
    await settle(10);
    expect(store().userId).toBe(FIXTURE_PROFILE_ID);
    expect(store().profile?.usage?.passes[0]?.type).toBe('adventurer');
    expect(api.requests).toHaveLength(0);
  });

  it('the profile-read hooks run after every successful read, with the profile, before launch ends', async () => {
    const seen: string[] = [];
    let loadingDuringHook: boolean | null = null;
    unregister.push(
      registerProfileReadHook('test.reconcile', ({ memberId, profile }) => {
        loadingDuringHook ??= store().isLoading;
        seen.push(`${memberId}:${profile.fullName}`);
      }),
    );
    await storeSession(MEMBER_A);
    serveMember({ fullName: 'Anna' });
    await store().bootstrap();
    expect(loadingDuringHook).toBe(true);

    api.on('GET', '/profile', Reply.problem(500, 'internal_error'));
    await store().loadProfile();
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true, fullName: 'Anna B' })));
    await store().loadProfile();
    expect(seen).toEqual([`${MEMBER_A}:Anna`, `${MEMBER_A}:Anna B`]);
  });
  it('a profile-read hook that never settles holds the launch screen for its budget only', async () => {
    let called = false;
    unregister.push(
      registerProfileReadHook('test.hung', () => {
        called = true;
        return new Promise<void>(() => undefined);
      }),
    );
    await storeSession(MEMBER_A);
    serveMember();
    // Only the timeouts are faked: the reads still go through.
    jest.useFakeTimers({
      doNotFake: [
        'Date',
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'performance',
        'hrtime',
      ],
    });
    const turns = async (until: () => boolean) => {
      for (let i = 0; i < 200 && !until(); i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    };
    try {
      const launch = store().bootstrap();
      await turns(() => called);
      expect(called).toBe(true);
      expect(store().profile?.id).toBe(MEMBER_A);
      await jest.advanceTimersByTimeAsync(PROFILE_READ_HOOK_BUDGET_MS - 1);
      expect(store().isLoading).toBe(true);
      await jest.advanceTimersByTimeAsync(1);
      // Never `await launch` before it is known to be done: a launch that
      // hangs must fail this test, not every test after it.
      await turns(() => !store().isLoading);
      expect(store().isLoading).toBe(false);
      expect(store().isAuthenticated).toBe(true);
      await launch;
    } finally {
      jest.useRealTimers();
    }
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

  it('a sign-in that lands while launch finds no stored session (an auth link that opened a signed-out phone) signs the member in once', async () => {
    serveMember();
    authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
    // Launch asks for the session before the link's session is stored, and hears "none".
    let answer!: (value: Awaited<ReturnType<typeof supabase.auth.getSession>>) => void;
    const getSession = jest
      .spyOn(supabase.auth, 'getSession')
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    try {
      const launch = store().bootstrap();
      await settle();
      const session = sessionJSON(MEMBER_A, 3600);
      await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      await settle();
      expect(store().isAuthenticated).toBe(false);
      answer({ data: { session: null }, error: null });
      await launch;
      await settle(10);
      expect(store().isAuthenticated).toBe(true);
      expect(store().userId).toBe(MEMBER_A);
      expect(store().isLoading).toBe(false);
      expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
    } finally {
      getSession.mockRestore();
    }
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

  it("another member signing in never sees the last member's profile, or the Kenni nudge armed for them", async () => {
    // A fresh, unverified account: its nudge is armed.
    serveMember({ fullName: 'Anna', kennitalaVerified: false, createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    await store().handleSignIn(MEMBER_A);
    expect(store().profile?.fullName).toBe('Anna');
    expect(store().pendingKennitalaPrompt).toBe(true);
    let profileWhileB: unknown = 'unread';
    let nudgeWhileB: boolean | null = null;
    api.on('GET', '/profile', () => {
      profileWhileB = store().profile;
      nudgeWhileB = store().pendingKennitalaPrompt;
      return Reply.ok(
        profileJSON({ id: MEMBER_B, fullName: 'Björn', kennitalaVerified: true, createdAt: '2025-03-01T09:00:00Z' }),
      );
    });
    // An auth link for a verified, older account, opened with no sign-out in between.
    await store().handleSignIn(MEMBER_B);
    expect(profileWhileB).toBeNull();
    expect(nudgeWhileB).toBe(false);
    expect(store().profile?.fullName).toBe('Björn');
    expect(store().pendingKennitalaPrompt).toBe(false);
  });

  it("another member signing in never keeps the last member's plan, even when that member's profile never loaded", async () => {
    api.on('GET', '/profile', Reply.problem(500, 'internal_error'));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await store().handleSignIn(MEMBER_A);
    await settle();
    expect(store().profile).toBeNull();
    expect(store().subscription?.productSlug).toBe('plan-plus');

    // An auth link for another account opened on this phone, both reads failing.
    api.on('GET', '/subscriptions', Reply.problem(500, 'internal_error'));
    await store().handleSignIn(MEMBER_B);
    await settle();
    expect(store().userId).toBe(MEMBER_B);
    expect(store().subscription).toBeNull();
    expect(store().subscriptionLoaded).toBe(false);
    expect(selectPurchaseStateKnown(store())).toBe(false);
  });

  it('a sign-in for the member already signed in, once theirs has finished, runs in full again (an auth link)', async () => {
    serveMember();
    await store().handleSignIn(MEMBER_A);
    await settle();
    const profiles = api.sentAll('/profile', 'GET').length;
    const plans = api.sentAll('/subscriptions', 'GET').length;
    await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, 'is');

    await store().handleSignIn(MEMBER_A, { suppressKennitalaPrompt: true });
    await settle();
    expect(api.sentAll('/profile', 'GET')).toHaveLength(profiles + 1);
    expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(plans + 1);
    // As iOS: a sign-in forgets the cached account language, then the read stores it again.
    expect(await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY)).toBe('en');
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

    it("not for a password-recovery sign-in that comes after the link's own sign-in finished", async () => {
      serveMember({ kennitalaVerified: false, createdAt: fresh() });
      await store().handleSignIn(MEMBER_A);
      expect(store().pendingKennitalaPrompt).toBe(true);
      await store().handleSignIn(MEMBER_A, { suppressKennitalaPrompt: true });
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

  describe('the member is signed out at once, as on iOS (session off the phone first, the server told after)', () => {
    it('online, with a logout the auth server holds: the logout goes after, everywhere, with their token', async () => {
      await signedIn();
      const token = (await readStoredSession(SUPABASE_STORAGE_KEY))!.access_token;
      let release!: () => void;
      let atLogout: { signedIn: boolean; stored: boolean } | null = null;
      authHost.on('POST', '/auth/v1/logout', async () => {
        atLogout = { signedIn: store().isAuthenticated, stored: !(await noStoredSession()) };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Reply.empty(204);
      });

      const started = Date.now();
      await store().signOut();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(store().isAuthenticated).toBe(false);
      expect(store().userId).toBeNull();
      expect(await noStoredSession()).toBe(true);

      await eventually(() => authHost.sentAll('/auth/v1/logout', 'POST').length === 1);
      const logout = authHost.sent('/auth/v1/logout', 'POST');
      expect(logout.query.scope).toBe('global');
      expect(logout.headers.authorization).toBe(`Bearer ${token}`);
      expect(atLogout).toEqual({ signedIn: false, stored: false });
      release();
      await serverLogoutSettledForTests();
    });

    it('offline after an offline cold start, with an expired token and a refresh still retrying', async () => {
      await storeSession(MEMBER_A, -60);
      netInfo({ isConnected: false, isInternetReachable: false });
      const endpoint = refreshEndpoint(() => Reply.fail());
      api.on('GET', '/profile', Reply.fail());
      api.on('GET', '/subscriptions', Reply.fail());
      authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
      const seen: (string | null)[] = [];
      unregister.push(registerSignOutCleaner('test.member', ({ memberId }) => void seen.push(memberId)));
      await store().bootstrap();
      expect(store().isAuthenticated).toBe(true);
      // The SDK is retrying the expired token's refresh (it holds its session lock while it does).
      const refreshing = supabase.auth.getSession();
      await settle();
      expect(authHost.sentAll('/auth/v1/token', 'POST').length).toBeGreaterThan(0);

      const started = Date.now();
      await store().signOut();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(store().isAuthenticated).toBe(false);
      expect(await noStoredSession()).toBe(true);
      expect(seen).toEqual([MEMBER_A]);
      await serverLogoutSettledForTests();
      // Offline: the auth server is not asked; its copy expires on its own.
      expect(authHost.sentAll('/auth/v1/logout', 'POST')).toHaveLength(0);

      // The phone comes back and the SDK's retry finally gets a session: it does not stay.
      netInfo({ isConnected: true, isInternetReachable: true });
      await endpoint.recover();
      await refreshing;
      await eventually(noStoredSession);
      expect(await noStoredSession()).toBe(true);
      expect(store().isAuthenticated).toBe(false);
      expect(seen).toEqual([MEMBER_A]);
      await serverLogoutSettledForTests();
    });

    it('a second tap joins the sign-out under way', async () => {
      await signedIn();
      let hooks = 0;
      let cleaners = 0;
      unregister.push(registerPreSignOutHook('test.count', () => void (hooks += 1)));
      unregister.push(registerSignOutCleaner('test.count', () => void (cleaners += 1)));
      authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
      const first = store().signOut();
      const second = store().signOut();
      expect(second).toBe(first);
      await first;
      await settle(10);
      expect(hooks).toBe(1);
      expect(cleaners).toBe(1);
      await serverLogoutSettledForTests();
      expect(authHost.sentAll('/auth/v1/logout', 'POST')).toHaveLength(1);
    });
  });

  describe('a refresh that answers after the member signed out', () => {
    /**
     * What a refresh supabase-js was still retrying does when it finally
     * answers (offline with an expired token, it retries for 30 s): the SDK's
     * `_callRefreshToken` saves the session it got and says TOKEN_REFRESHED.
     * `setSession` with an expired token runs exactly that path.
     */
    async function lateRefresh(userId: string): Promise<void> {
      authHost.on('POST', '/auth/v1/token', Reply.json(200, sessionJSON(userId, 7200, 'refresh-late')));
      const expired = sessionJSON(userId, -60);
      await supabase.auth.setSession({ access_token: expired.access_token, refresh_token: expired.refresh_token });
    }

    async function signedInThenOut(): Promise<void> {
      await signedIn();
      authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
      await store().signOut();
      await settle(10);
      await serverLogoutSettledForTests();
      expect(await noStoredSession()).toBe(true);
    }

    it('does not bring their session back', async () => {
      let runs = 0;
      unregister.push(registerSignOutCleaner('test.count', () => void (runs += 1)));
      await signedInThenOut();
      expect(runs).toBe(1);

      await lateRefresh(MEMBER_A);
      await eventually(noStoredSession);
      expect(await noStoredSession()).toBe(true);
      expect(store().isAuthenticated).toBe(false);
      expect(store().userId).toBeNull();
      // Ended on the server too, as the sign-out meant, and wiped only once.
      await eventually(() => authHost.sentAll('/auth/v1/logout', 'POST').length === 2);
      expect(authHost.sentAll('/auth/v1/logout', 'POST')).toHaveLength(2);
      expect(runs).toBe(1);
    });

    it('leaves the session of the same member signing in again alone', async () => {
      await signedInThenOut();
      authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_A, 3600).user));
      const again = sessionJSON(MEMBER_A, 3600, 'refresh-again');
      await supabase.auth.setSession({ access_token: again.access_token, refresh_token: again.refresh_token });
      await settle(10);
      expect(store().isAuthenticated).toBe(true);

      await lateRefresh(MEMBER_A);
      await settle(20);
      expect(store().isAuthenticated).toBe(true);
      expect((await readStoredSession(SUPABASE_STORAGE_KEY))?.refresh_token).toBe('refresh-late');
      expect(store().session?.refresh_token).toBe('refresh-late');
      expect(authHost.sentAll('/auth/v1/logout', 'POST')).toHaveLength(1);
    });

    it("signs out a member who signed in meanwhile rather than leave them on the last member's session", async () => {
      await signedInThenOut();
      api.on('GET', '/profile', Reply.ok(profileJSON({ id: MEMBER_B, kennitalaVerified: true })));
      authHost.on('GET', '/auth/v1/user', Reply.json(200, sessionJSON(MEMBER_B, 3600).user));
      const b = sessionJSON(MEMBER_B, 3600, 'refresh-b');
      await supabase.auth.setSession({ access_token: b.access_token, refresh_token: b.refresh_token });
      await settle(10);
      expect(store().userId).toBe(MEMBER_B);

      await lateRefresh(MEMBER_A);
      await eventually(async () => !store().isAuthenticated && (await noStoredSession()));
      expect(store().isAuthenticated).toBe(false);
      expect(store().profile).toBeNull();
      expect(await noStoredSession()).toBe(true);
    });
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
