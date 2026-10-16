/**
 * What the client does when the session is the problem: the port of iOS
 * `APIClientAuthTests` (the same eight cases), then the same rules through
 * the real Supabase client against the stub auth server.
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
} from '@supabase/supabase-js';

import { api, Reply, supabase as authHost } from '@test/server';

import { supabase } from '../../supabase/lib/client';
import {
  createApiClient,
  RefreshRefusedError,
  refreshRefused,
  supabaseAccessToken,
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

const authorizations = () => api.requests.map((r) => r.headers.authorization);

// A spy left behind by a failing test must not change the next one.
afterEach(() => {
  jest.restoreAllMocks();
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

    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
    const error = (await failure(createApiClient().get('/profile'))) as TransportError;
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
 * The same rules with nothing faked but the servers: the app's own Supabase
 * client, signed in against the stub auth server.
 */
describe('through Supabase', () => {
  const user = { id: '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11', aud: 'authenticated', role: 'authenticated', email: 'member@example.com' };

  function jwt(expiresInSeconds: number): string {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, exp, role: 'authenticated' })}.c2lnbmF0dXJl`;
  }

  const firstToken = jwt(3600);
  const freshToken = jwt(7200);

  async function signIn(): Promise<string[]> {
    authHost.on('GET', '/auth/v1/user', Reply.json(200, user));
    const { error } = await supabase.auth.setSession({ access_token: firstToken, refresh_token: 'refresh-1' });
    if (error) throw error;
    const events: string[] = [];
    const { data } = supabase.auth.onAuthStateChange((event) => {
      events.push(event);
    });
    subscriptions.push(() => data.subscription.unsubscribe());
    return events;
  }

  const subscriptions: (() => void)[] = [];
  afterEach(async () => {
    while (subscriptions.length) subscriptions.pop()!();
    await AsyncStorage.clear();
  });

  it('sends the live session token and refreshes it after a 401', async () => {
    await signIn();
    api.on('GET', '/profile', (request) =>
      request.headers.authorization === `Bearer ${freshToken}`
        ? Reply.ok({ id: user.id })
        : Reply.problem(401, 'authentication_required'),
    );
    authHost.on(
      'POST',
      '/auth/v1/token',
      Reply.json(200, {
        access_token: freshToken,
        refresh_token: 'refresh-2',
        token_type: 'bearer',
        expires_in: 7200,
        expires_at: Math.floor(Date.now() / 1000) + 7200,
        user,
      }),
    );
    await expect(createApiClient().get('/profile')).resolves.toEqual({ id: user.id });
    expect(authorizations()).toEqual([`Bearer ${firstToken}`, `Bearer ${freshToken}`]);
    expect(authHost.sent('/auth/v1/token').query.grant_type).toBe('refresh_token');
  });

  it('a refused refresh signs out on this phone and asks to sign in', async () => {
    const events = await signIn();
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
    await signIn();
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
});
