/**
 * What the client does when the session is the problem: the port of iOS
 * `APIClientAuthTests` (the same eight cases), the limits on the wait for the
 * session (iOS fails at once where supabase-js retries for 25 s), then the
 * same rules through the real Supabase client against the stub auth server,
 * with and without ./authFetch.
 *
 * Before iOS 2.5.0 an offline refresh of an expired token read as "Please
 * sign in", and a session revoked elsewhere (a password reset, "sign out
 * everywhere") left every screen showing the server's 401 until the token
 * expired on its own, with no way back to sign-in. Android had no 401
 * handling at all.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Buffer } from 'node:buffer';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  api,
  Reply,
  supabase as authHost,
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_URL,
  type StubReply,
} from '@test/server';

import { supabase } from '../../supabase/lib/client';
import { createAuthFetch, type RefreshTrouble } from '../authFetch';
import {
  createApiClient,
  createApiClient as createApiClientWith,
  RefreshRefusedError,
  refreshRefused,
  supabaseAccessToken,
  supabaseSessionDeps,
} from '../client';
import { ApiError, NotAuthenticatedError, ProblemError, TransportError } from '../errors';
import { createStubApiClient } from '../testing';

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

/** `promise`'s error and how long it took to arrive, in milliseconds. */
async function timedFailure(promise: Promise<unknown>): Promise<{ error: unknown; ms: number }> {
  const started = Date.now();
  const error = await failure(promise);
  return { error, ms: Date.now() - started };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const authorizations = () => api.requests.map((r) => r.headers.authorization);

/** What NetInfo answers (the library mock's default is connected). */
function netInfo(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): void {
  jest.mocked(NetInfo.fetch).mockResolvedValue({ type: 'wifi', details: null, ...state } as never);
}

/** A trouble feed a test drives by hand, for the stub client. */
function troubleFeed() {
  const listeners = new Set<(trouble: RefreshTrouble) => void>();
  return {
    subscribe: (listener: (trouble: RefreshTrouble) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (trouble: RefreshTrouble) => [...listeners].forEach((listener) => listener(trouble)),
    get listening() {
      return listeners.size;
    },
  };
}

const never = <T>() => new Promise<T>(() => undefined);

// A spy left behind by a failing test must not change the next one, and
// NetInfo's answer is the mock's default again.
afterEach(() => {
  jest.restoreAllMocks();
  netInfo({ isConnected: true, isInternetReachable: true });
});

describe('APIClientAuthTests (iOS)', () => {
  it('an offline refresh is offline, not signed out', async () => {
    const { client } = createStubApiClient({
      token: async () => {
        throw new TransportError('offline');
      },
    });
    const error = await failure(client.get('/profile'));
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).transport).toBe('offline');
    expect(api.requests).toHaveLength(0);
  });

  it('a 401 refreshes once and resends a GET', async () => {
    api.on('GET', '/profile', (request) =>
      request.headers.authorization === 'Bearer refreshed-token'
        ? Reply.ok({ value: 'fresh' })
        : Reply.problem(401, 'authentication_required'),
    );
    const session = createStubApiClient();
    await expect(session.client.get('/profile')).resolves.toEqual({ value: 'fresh' });
    expect(authorizations()).toEqual(['Bearer test-token', 'Bearer refreshed-token']);
    expect(session.refreshes).toBe(1);
    expect(session.revoked).toBe(0);
  });

  it('a 401 resends a write that carries an Idempotency-Key, under the same key', async () => {
    api.on('POST', '/bookings', (request) =>
      request.headers.authorization === 'Bearer refreshed-token'
        ? Reply.ok({ value: 'booked' })
        : Reply.problem(401, 'authentication_required'),
    );
    const { client } = createStubApiClient();
    await expect(client.post('/bookings', { value: 'x' }, { idempotencyKey: 'key-1' })).resolves.toEqual({
      value: 'booked',
    });
    expect(api.requests.map((r) => r.headers['idempotency-key'])).toEqual(['key-1', 'key-1']);
    expect(api.requests.map((r) => r.body)).toEqual([{ value: 'x' }, { value: 'x' }]);
  });

  it('a 401 never resends a write without a key', async () => {
    api.on('POST', '/profile/locale', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient();
    const error = await failure(session.client.post('/profile/locale', { value: 'is' }));
    expect((error as ApiError).status).toBe(401);
    expect(error).toBeInstanceOf(ProblemError);
    expect(api.requests).toHaveLength(1);
    expect(session.revoked).toBe(0);
  });

  it('a refused refresh ends the session', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient({
      refreshedToken: async () => {
        throw new RefreshRefusedError();
      },
    });
    const error = await failure(session.client.get('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect(session.revoked).toBe(1);
    expect(api.requests).toHaveLength(1);
  });

  it('a second 401 with a fresh token ends the session', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient();
    const error = await failure(session.client.get('/profile'));
    expect((error as ApiError).code).toBe('not_authenticated');
    expect(session.revoked).toBe(1);
    expect(api.requests).toHaveLength(2);
  });

  it('a failing auth server keeps the session (members are not signed out by an outage)', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient({
      refreshedToken: async () => {
        throw new AuthRetryableFetchError('Service Unavailable', 503);
      },
    });
    const error = await failure(session.client.get('/profile'));
    expect((error as ApiError).status).toBe(401);
    expect(session.revoked).toBe(0);
    expect(refreshRefused(new Error('auth 400'))).toBe(false);
    expect(refreshRefused({ code: 'session_not_found' })).toBe(false);
  });

  it('an offline refresh after a 401 keeps the session', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient({
      refreshedToken: async () => {
        throw new TransportError('offline');
      },
    });
    const error = await failure(session.client.get('/profile'));
    expect((error as ApiError).status).toBe(401);
    expect(session.revoked).toBe(0);
  });
});

describe('Android additions', () => {
  it('a refresh that answers no session ends it', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient({ refreshedToken: async () => null });
    expect(await failure(session.client.get('/profile'))).toBeInstanceOf(NotAuthenticatedError);
    expect(session.revoked).toBe(1);
    expect(api.requests).toHaveLength(1);
  });

  it('calls that hit the same 401 together share one refresh', async () => {
    api.on('GET', '/:what', (request) =>
      request.headers.authorization === 'Bearer refreshed-token'
        ? Reply.ok({ what: request.params.what })
        : Reply.problem(401, 'authentication_required'),
    );
    let resolveRefresh: (token: string) => void = () => undefined;
    let calls = 0;
    const session = createStubApiClient({
      refreshedToken: () => {
        calls += 1;
        return new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        });
      },
    });
    const all = Promise.all([session.client.get('/a'), session.client.get('/b'), session.client.get('/c')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveRefresh('refreshed-token');
    await expect(all).resolves.toEqual([{ what: 'a' }, { what: 'b' }, { what: 'c' }]);
    expect(calls).toBe(1);
  });

  it('a resend that fails on the way is a transport error, the session kept', async () => {
    api.once('GET', '/profile', Reply.problem(401, 'authentication_required'));
    api.once('GET', '/profile', Reply.fail());
    const session = createStubApiClient();
    const error = await failure(session.client.get('/profile'));
    expect(error).toBeInstanceOf(TransportError);
    expect(session.revoked).toBe(0);
  });

  it("only the auth server's own refusals count", () => {
    for (const code of [
      'session_not_found',
      'session_expired',
      'refresh_token_not_found',
      'refresh_token_already_used',
      'user_not_found',
      'user_banned',
    ]) {
      expect(refreshRefused(new AuthApiError('refused', 400, code))).toBe(true);
    }
    expect(refreshRefused(new AuthSessionMissingError())).toBe(true);
    expect(refreshRefused(new AuthApiError('bad', 400, 'validation_failed'))).toBe(false);
    expect(refreshRefused(new AuthApiError('old server', 400, undefined))).toBe(false);
    expect(refreshRefused(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(false);
    expect(refreshRefused(new AuthRetryableFetchError('Bad gateway', 502))).toBe(false);
  });

  it("an unreachable auth server reading the token is a transport error, not 'sign in'", async () => {
    jest
      .spyOn(supabase.auth, 'getSession')
      .mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    // Online, the auth server simply could not be reached.
    expect(((await failure(supabaseAccessToken())) as TransportError).transport).toBe('network');

    // Connected (so the call asks for the token), but the internet is out of reach.
    netInfo({ isConnected: true, isInternetReachable: false });
    const getSession = jest.mocked(supabase.auth.getSession);
    const error = (await failure(createApiClient().get('/profile'))) as TransportError;
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.transport).toBe('offline');
    expect(api.requests).toHaveLength(0);
  });

  it('an auth server that is down while reading the token is not offline either', async () => {
    jest
      .spyOn(supabase.auth, 'getSession')
      .mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Bad gateway', 502) });
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
    expect(((await failure(supabaseAccessToken())) as TransportError).transport).toBe('network');
  });
});

/**
 * The session step of a call has the call's limits. supabase-js retries a
 * failing refresh for up to 30 s behind one lock, so a token read or a
 * refresh could otherwise hold a screen's spinner for 25 s or more where iOS
 * fails at once.
 */
describe('the wait on the session', () => {
  it('a phone with no network is offline before the auth SDK is asked', async () => {
    const token = jest.fn(async () => 'test-token');
    const session = createStubApiClient({ token, isDeviceDisconnected: async () => true });
    const error = (await failure(session.client.get('/profile'))) as TransportError;
    expect(error).toBeInstanceOf(TransportError);
    expect(error.transport).toBe('offline');
    expect(token).not.toHaveBeenCalled();
    expect(api.requests).toHaveLength(0);
  });

  it('an optional route on a phone with no network goes out without asking for a token', async () => {
    api.on('GET', '/attractions', Reply.ok([]));
    const token = jest.fn(async () => 'test-token');
    const session = createStubApiClient({ token, isDeviceDisconnected: async () => true });
    await session.client.get('/attractions', undefined, { auth: 'optional' });
    expect(token).not.toHaveBeenCalled();
    expect(api.sent('/attractions').headers.authorization).toBeUndefined();
  });

  it('only a missing connection counts, never an unreachable-internet probe', async () => {
    api.on('GET', '/profile', Reply.ok({ id: 'p1' }));
    // Android can report `isInternetReachable: false` on working Wi-Fi.
    netInfo({ isConnected: true, isInternetReachable: false });
    const app = createApiClient({ accessToken: async () => 'test-token' });
    await expect(app.get('/profile')).resolves.toEqual({ id: 'p1' });
  });

  it('a token read that outlives the ceiling is a timeout, the session kept', async () => {
    const session = createStubApiClient({ token: never });
    const { error, ms } = await timedFailure(session.client.get('/profile', undefined, { timeoutMs: 40 }));
    expect((error as TransportError).transport).toBe('timeout');
    expect(ms).toBeLessThan(1000);
    expect(session.revoked).toBe(0);
    expect(api.requests).toHaveLength(0);
  });

  it("the caller's cancel ends a token read", async () => {
    const controller = new AbortController();
    const session = createStubApiClient({ token: never });
    const pending = failure(session.client.get('/profile', undefined, { signal: controller.signal }));
    await sleep(10);
    controller.abort();
    expect(((await pending) as TransportError).transport).toBe('cancelled');
    expect(api.requests).toHaveLength(0);
  });

  it('an optional route whose token read times out goes out without one', async () => {
    api.on('GET', '/attractions', Reply.ok([]));
    const session = createStubApiClient({ token: never });
    await session.client.get('/attractions', undefined, { auth: 'optional', timeoutMs: 30 });
    expect(api.sent('/attractions').headers.authorization).toBeUndefined();
  });

  it('a failed refresh reported while the token is read ends the wait at once', async () => {
    const feed = troubleFeed();
    const failing = createStubApiClient({ token: never, onRefreshTrouble: feed.subscribe });
    const pending = failure(failing.client.get('/profile'));
    await sleep(10);
    feed.emit('failing');
    expect(((await pending) as TransportError).transport).toBe('network');

    // No answer at all, and NetInfo says the internet is out of reach.
    const unreachable = createStubApiClient({
      token: never,
      onRefreshTrouble: feed.subscribe,
      isDeviceOffline: async () => true,
    });
    const offline = failure(unreachable.client.get('/profile'));
    await sleep(10);
    feed.emit('unreachable');
    expect(((await offline) as TransportError).transport).toBe('offline');
    expect(feed.listening).toBe(0);
    expect(api.requests).toHaveLength(0);
  });

  it('after a 401, a failed refresh attempt rethrows the 401 at once and keeps the session', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const feed = troubleFeed();
    const session = createStubApiClient({ refreshedToken: never, onRefreshTrouble: feed.subscribe });
    const first = failure(session.client.get('/profile'));
    await sleep(10);
    feed.emit('failing');
    const error = (await first) as ProblemError;
    expect(error).toBeInstanceOf(ProblemError);
    expect(error.status).toBe(401);
    expect(session.revoked).toBe(0);

    // A call that joins the refresh already known to be failing does not
    // wait for the SDK's next attempt.
    const { error: joined, ms } = await timedFailure(session.client.get('/profile', undefined, { timeoutMs: 5000 }));
    expect((joined as ProblemError).status).toBe(401);
    expect(ms).toBeLessThan(1000);
    expect(session.refreshes).toBe(1);
    expect(session.revoked).toBe(0);
  });

  it('after a 401, a refresh that outlives the ceiling is a timeout, the session kept', async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient({ refreshedToken: never });
    const error = (await failure(session.client.get('/profile', undefined, { timeoutMs: 40 }))) as TransportError;
    expect(error.transport).toBe('timeout');
    expect(session.revoked).toBe(0);
    expect(api.requests).toHaveLength(1);
  });

  it("after a 401, the caller's cancel ends the wait on the refresh", async () => {
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const controller = new AbortController();
    const session = createStubApiClient({ refreshedToken: never });
    const pending = failure(session.client.get('/profile', undefined, { signal: controller.signal }));
    await sleep(20);
    controller.abort();
    expect(((await pending) as TransportError).transport).toBe('cancelled');
    expect(session.revoked).toBe(0);
  });
});

/**
 * The same rules with nothing faked but the servers: the app's own Supabase
 * client (or one built the way F3 is asked to build it, with ./authFetch),
 * signed in against the stub auth server.
 */
const user = { id: '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11', aud: 'authenticated', role: 'authenticated', email: 'member@example.com' };

function jwt(expiresInSeconds: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, exp, role: 'authenticated' })}.c2lnbmF0dXJl`;
}

function sessionReply(accessToken: string): StubReply {
  return Reply.json(200, {
    access_token: accessToken,
    refresh_token: 'refresh-2',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user,
  });
}

const subscriptions: (() => void)[] = [];
afterEach(async () => {
  while (subscriptions.length) subscriptions.pop()!();
  await AsyncStorage.clear();
});

/**
 * Signs `client` in with `accessToken` and records its auth events. The
 * listener goes on first, so its INITIAL_SESSION finds no session and starts
 * no refresh of its own.
 */
async function signIn(client: SupabaseClient, accessToken: string): Promise<string[]> {
  const events: string[] = [];
  const { data } = client.auth.onAuthStateChange((event) => {
    events.push(event);
  });
  subscriptions.push(() => data.subscription.unsubscribe());
  authHost.on('GET', '/auth/v1/user', Reply.json(200, user));
  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: 'refresh-1' });
  if (error) throw error;
  return events;
}

/**
 * The refresh endpoint, answering `failure` until `recover()`, then a fresh
 * session. A test that leaves supabase-js retrying a refresh recovers before
 * it ends, so the retries finish inside the test that started them.
 */
function refreshEndpoint(failure: () => StubReply, freshToken: string) {
  let up = false;
  authHost.on('POST', '/auth/v1/token', () => (up ? sessionReply(freshToken) : failure()));
  return {
    async recover(client: SupabaseClient): Promise<string | undefined> {
      up = true;
      // Waits behind the SDK's lock until its retrying refresh has finished.
      return (await client.auth.getSession()).data.session?.access_token;
    },
  };
}

describe('through Supabase', () => {
  const firstToken = jwt(3600);
  const freshToken = jwt(7200);
  // The SDK on its own, built the way the first Android build built the
  // app's client (plain fetch, no ./authFetch): what the API client must cope
  // with by itself. The app's client fetches through ./authFetch since F3,
  // which fails a waiting call at the first failed refresh; the next block
  // covers that.
  const supabase = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      storageKey: 'sb-plain-sdk-test-auth-token',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  const createApiClient = () => createApiClientWith(supabaseSessionDeps(supabase));

  it('sends the live session token and refreshes it after a 401', async () => {
    await signIn(supabase, firstToken);
    api.on('GET', '/profile', (request) =>
      request.headers.authorization === `Bearer ${freshToken}`
        ? Reply.ok({ id: user.id })
        : Reply.problem(401, 'authentication_required'),
    );
    authHost.on('POST', '/auth/v1/token', sessionReply(freshToken));
    await expect(createApiClient().get('/profile')).resolves.toEqual({ id: user.id });
    expect(authorizations()).toEqual([`Bearer ${firstToken}`, `Bearer ${freshToken}`]);
    expect(authHost.sent('/auth/v1/token').query.grant_type).toBe('refresh_token');
  });

  it('a refused refresh signs out on this phone and asks to sign in', async () => {
    const events = await signIn(supabase, firstToken);
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    authHost.on(
      'POST',
      '/auth/v1/token',
      Reply.json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }),
    );
    authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
    const error = await failure(createApiClient().get('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(events).toContain('SIGNED_OUT');
    expect(api.requests).toHaveLength(1);
  });

  it('an auth server outage keeps the session and the 401 stands', async () => {
    await signIn(supabase, firstToken);
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    // supabase-js retries a failing refresh with back-off for up to 30 s of
    // wall time; the clock jumps past that on the first attempt.
    let skew = 0;
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    authHost.on('POST', '/auth/v1/token', () => {
      skew += 31_000;
      return Reply.json(503, { code: 503, msg: 'unavailable' });
    });
    const error = await failure(createApiClient().get('/profile'));
    clock.mockRestore();
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).status).toBe(401);
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
    expect((await supabase.auth.getSession()).data.session?.access_token).toBe(firstToken);
  });

  it('offline with an expired token and the refresh ticker running: offline at once, nothing sent', async () => {
    // Expires inside supabase-js's 90 s margin, so it must be refreshed first.
    const events = await signIn(supabase, jwt(60));
    const endpoint = refreshEndpoint(() => Reply.fail(), freshToken);
    netInfo({ isConnected: false, isInternetReachable: false });
    // supabase-js's auto-refresh ticker is always on in React Native (and
    // here). Restarting it runs a tick at once, whose refresh retries for up
    // to 30 s holding the session lock.
    await supabase.auth.startAutoRefresh();
    await sleep(20);

    const { error, ms } = await timedFailure(createApiClient().get('/profile'));
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).transport).toBe('offline');
    expect(ms).toBeLessThan(500);
    expect(api.requests).toHaveLength(0);

    // The SDK really was busy: a session read still waits behind the ticker.
    const read = supabase.auth.getSession();
    expect(await Promise.race([read.then(() => 'settled'), sleep(100).then(() => 'busy')])).toBe('busy');

    netInfo({ isConnected: true, isInternetReachable: true });
    expect(await endpoint.recover(supabase)).toBe(freshToken);
    await read;
    expect(events).not.toContain('SIGNED_OUT');
  });

  it('online with the auth server out of reach, the wait on the session ends at the call ceiling', async () => {
    const events = await signIn(supabase, jwt(60));
    const endpoint = refreshEndpoint(() => Reply.fail(), freshToken);
    await supabase.auth.startAutoRefresh();
    await sleep(20);

    const { error, ms } = await timedFailure(createApiClient().get('/profile', undefined, { timeoutMs: 300 }));
    expect((error as TransportError).transport).toBe('timeout');
    expect(ms).toBeLessThan(1000);

    const controller = new AbortController();
    const cancelled = failure(createApiClient().get('/profile', undefined, { signal: controller.signal }));
    await sleep(30);
    controller.abort();
    expect(((await cancelled) as TransportError).transport).toBe('cancelled');
    expect(api.requests).toHaveLength(0);

    expect(await endpoint.recover(supabase)).toBe(freshToken);
    expect(events).not.toContain('SIGNED_OUT');
  });

  it.each([
    ['fails on the way', () => Reply.fail()],
    ['answers 500', () => Reply.json(500, { code: 500, error_code: 'unexpected_failure', msg: 'boom' })],
  ])('a second 401 ends the session even when the logout %s', async (_name, logout) => {
    const events = await signIn(supabase, firstToken);
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    authHost.on('POST', '/auth/v1/token', sessionReply(freshToken));
    authHost.on('POST', '/auth/v1/logout', logout());
    const error = await failure(createApiClient().get('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect(authHost.sentAll('/auth/v1/logout')).toHaveLength(1);
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });

  it('the SDK still has the local removal a failed logout falls back to', () => {
    expect(typeof (supabase.auth as unknown as { _removeSession?: unknown })._removeSession).toBe('function');
  });
});

/**
 * With ./authFetch as the Supabase client's fetch, as F3 is asked to install
 * it: what supabase-js would otherwise get wrong on its own.
 */
describe('through Supabase with the auth fetch', () => {
  const firstToken = jwt(3600);
  const freshToken = jwt(7200);
  const storageKey = 'sb-auth-fetch-test-auth-token';

  function wrappedClient(): SupabaseClient {
    return createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, {
      global: { fetch: createAuthFetch() },
      auth: { storage: AsyncStorage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    });
  }

  it.each([
    ['500', 500, 'unexpected_failure'],
    ['429', 429, 'over_request_rate_limit'],
  ])('a refresh answered %s keeps the session, and the 401 stands at once', async (_name, status, code) => {
    const client = wrappedClient();
    const events = await signIn(client, firstToken);
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    const endpoint = refreshEndpoint(() => Reply.json(status, { code: status, error_code: code, msg: 'failing' }), freshToken);

    const { error, ms } = await timedFailure(createApiClient(supabaseSessionDeps(client)).get('/profile'));
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).status).toBe(401);
    expect(ms).toBeLessThan(500);
    expect(await AsyncStorage.getItem(storageKey)).not.toBeNull();
    expect(events).not.toContain('SIGNED_OUT');

    expect(await endpoint.recover(client)).toBe(freshToken);
    expect(events).not.toContain('SIGNED_OUT');
  });

  it('a refused refresh still ends the session', async () => {
    const client = wrappedClient();
    const events = await signIn(client, firstToken);
    api.on('GET', '/profile', Reply.problem(401, 'authentication_required'));
    authHost.on(
      'POST',
      '/auth/v1/token',
      Reply.json(400, { code: 400, error_code: 'session_not_found', msg: 'Session not found' }),
    );
    authHost.on('POST', '/auth/v1/logout', Reply.empty(204));
    const error = await failure(createApiClient(supabaseSessionDeps(client)).get('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(events).toContain('SIGNED_OUT');
  });

  it('an expired token with the auth server out of reach fails at the first attempt, not after 25 s', async () => {
    const client = wrappedClient();
    const events = await signIn(client, jwt(60));
    const endpoint = refreshEndpoint(() => Reply.fail(), freshToken);
    const app = createApiClient(supabaseSessionDeps(client));

    const { error, ms } = await timedFailure(app.get('/profile'));
    expect((error as TransportError).transport).toBe('network');
    expect(ms).toBeLessThan(500);

    // Connected, but NetInfo says the internet is out of reach: offline.
    netInfo({ isConnected: true, isInternetReachable: false });
    const offline = (await failure(app.get('/profile'))) as TransportError;
    expect(offline.transport).toBe('offline');
    expect(api.requests).toHaveLength(0);

    expect(await endpoint.recover(client)).toBe(freshToken);
    expect(events).not.toContain('SIGNED_OUT');
  });
});
