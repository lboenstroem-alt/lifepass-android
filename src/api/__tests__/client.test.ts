/**
 * The client core against the stub server: what goes on the wire, how the
 * envelope is unwrapped, and how every kind of failure is typed (the iOS
 * APIClient and APIError behaviour, plus the gaps the old Android client had:
 * the code read from `title`, no timeout, no transport errors).
 */
import NetInfo from '@react-native-community/netinfo';

import { api, Reply } from '@test/server';

import { translate } from '../../i18n';
import {
  API_TIMEOUTS,
  apiGet,
  apiPost,
  buildUrl,
  createApiClient,
  parseRetryAfter,
  setSharedApiClient,
} from '../client';
import {
  ApiError,
  DecodingError,
  HttpStatusError,
  isCancellation,
  isOffline,
  isProblem,
  isRetryable,
  NotAuthenticatedError,
  ProblemError,
  TransportError,
} from '../errors';
import { refusalFor, refusalMessage } from '../errorFormatter';
import { createStubApiClient, installStubApiClient } from '../testing';

const client = () => createStubApiClient().client;

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe('requests', () => {
  it('unwraps the envelope and sends the bearer, Accept and no-store', async () => {
    api.on('GET', '/profile', Reply.ok({ value: 'x' }));
    await expect(client().get('/profile')).resolves.toEqual({ value: 'x' });
    const sent = api.sent('/profile', 'GET');
    expect(sent.headers.authorization).toBe('Bearer test-token');
    expect(sent.headers.accept).toBe('application/json');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['content-type']).toBeUndefined();
    expect(sent.headers['idempotency-key']).toBeUndefined();
    // Nothing beyond the declared headers (iOS declares no app or platform header).
    expect(Object.keys(sent.headers).filter((h) => /lifepass|platform|version|x-app/i.test(h))).toEqual([]);
  });

  it('accepts a path with or without its leading slash', async () => {
    api.on('GET', '/venues', Reply.ok([]));
    await client().get('venues');
    await client().get('/venues');
    expect(api.sentAll('/venues')).toHaveLength(2);
  });

  it('leaves out empty query items, repeats arrays and encodes values', async () => {
    api.on('GET', '/classes', Reply.ok([]));
    await client().get('/classes', {
      from: '2026-10-16',
      q: 'jóga & pilates+',
      limit: 20,
      open: true,
      cursor: undefined,
      venue: null,
      blank: '',
      category: ['yoga', 'spin'],
    });
    const sent = api.sent('/classes');
    expect(sent.query).toEqual({ from: '2026-10-16', q: 'jóga & pilates+', limit: '20', open: 'true', category: 'spin' });
    expect(sent.url).toContain('category=yoga&category=spin');
    expect(sent.url).toContain('q=j%C3%B3ga%20%26%20pilates%2B');
  });

  it('builds URLs by hand', () => {
    expect(buildUrl('https://x.test/api/v1/', '/a/b')).toBe('https://x.test/api/v1/a/b');
    expect(buildUrl('https://x.test/api/v1', 'a', { k: 'v' })).toBe('https://x.test/api/v1/a?k=v');
    expect(buildUrl('https://x.test/api/v1', 'a?x=1', { k: 'v' })).toBe('https://x.test/api/v1/a?x=1&k=v');
  });

  it('posts JSON with its key, dates without milliseconds', async () => {
    api.on('POST', '/bookings', Reply.ok({ bookingId: 'b1' }, 201));
    const result = await client().post(
      '/bookings',
      { activityId: 'a1', startsAt: new Date('2026-10-02T14:00:00.000Z'), note: undefined, guest: null },
      { idempotencyKey: 'booking-key-1' },
    );
    expect(result).toEqual({ bookingId: 'b1' });
    const sent = api.sent('/bookings', 'POST');
    expect(sent.headers['content-type']).toBe('application/json');
    expect(sent.headers['idempotency-key']).toBe('booking-key-1');
    expect(sent.body).toEqual({ activityId: 'a1', startsAt: '2026-10-02T14:00:00Z', guest: null });
  });

  it('posts with no body at all', async () => {
    api.on('POST', '/bookings/:id/cancel', Reply.ok({ status: 'cancelled' }));
    await client().post('/bookings/b1/cancel', undefined, { idempotencyKey: 'cancel-key-1' });
    const sent = api.sent('/bookings/b1/cancel');
    expect(sent.rawBody).toBeNull();
    expect(sent.headers['content-type']).toBeUndefined();
  });

  it('has PUT, PATCH and DELETE, DELETE with or without a body', async () => {
    api.on('*', '/thing', (request) => Reply.ok({ method: request.method }));
    const c = client();
    await expect(c.put('/thing', { a: 1 })).resolves.toEqual({ method: 'PUT' });
    await expect(c.patch('/thing', { b: 2 })).resolves.toEqual({ method: 'PATCH' });
    await expect(c.delete('/thing')).resolves.toEqual({ method: 'DELETE' });
    await expect(c.delete('/thing', undefined, { body: { ids: ['x'] } })).resolves.toEqual({ method: 'DELETE' });
    const [put, patch, plainDelete, bodyDelete] = api.sentAll('/thing');
    expect(put.body).toEqual({ a: 1 });
    expect(patch.body).toEqual({ b: 2 });
    expect(plainDelete.rawBody).toBeNull();
    expect(bodyDelete.body).toEqual({ ids: ['x'] });
  });

  it('decodes through the caller, and a decoder that throws is a DecodingError', async () => {
    api.on('GET', '/profile', Reply.ok({ id: 'p1', locale: 'is' }));
    const decoded = await client().get('/profile', undefined, {
      decode: (data) => ({ language: (data as { locale: string }).locale }),
    });
    expect(decoded).toEqual({ language: 'is' });

    const error = await failure(
      client().get('/profile', undefined, {
        decode: () => {
          throw new Error('missing id');
        },
      }),
    );
    expect(error).toBeInstanceOf(DecodingError);
    expect((error as DecodingError).snippet).toContain('"locale":"is"');
    expect((error as DecodingError).code).toBe('decode_error');
  });

  it('keeps every key of the export, sorted', async () => {
    api.on('GET', '/account/export', Reply.ok({ zeta: 1, alpha: { b: 2, a: [3, { y: 1, x: 2 }] }, unknownNewField: 'kept' }));
    const text = await client().getRawData('/account/export');
    expect(text).toBe(
      JSON.stringify({ alpha: { a: [3, { x: 2, y: 1 }], b: 2 }, unknownNewField: 'kept', zeta: 1 }, null, 2),
    );
  });
});

describe('auth modes', () => {
  it('fails fast with no session on a required route, and sends nothing', async () => {
    const error = await failure(createStubApiClient({ token: null }).client.get('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect((error as ApiError).code).toBe('not_authenticated');
    expect(api.requests).toHaveLength(0);
  });

  it('sends an optional route without a token, cacheable', async () => {
    api.on('GET', '/attractions', Reply.ok([]));
    await createStubApiClient({ token: null }).client.get('/attractions', { locale: 'is' }, { auth: 'optional' });
    const sent = api.sent('/attractions');
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers['cache-control']).toBeUndefined();
  });

  it('sends an optional route with the token when there is one', async () => {
    api.on('GET', '/attractions', Reply.ok([]));
    await client().get('/attractions', undefined, { auth: 'optional' });
    expect(api.sent('/attractions').headers.authorization).toBe('Bearer test-token');
  });

  it('an optional route reads an unreadable token as no token', async () => {
    api.on('GET', '/attractions', Reply.ok([]));
    const offlineToken = createStubApiClient({
      token: async () => {
        throw new TransportError('offline');
      },
    });
    await offlineToken.client.get('/attractions', undefined, { auth: 'optional' });
    expect(api.sent('/attractions').headers.authorization).toBeUndefined();
  });

  it('never refreshes on an optional route', async () => {
    api.on('GET', '/attractions', Reply.problem(401, 'authentication_required'));
    const session = createStubApiClient();
    const error = await failure(session.client.get('/attractions', undefined, { auth: 'optional' }));
    expect(error).toBeInstanceOf(ProblemError);
    expect(session.refreshes).toBe(0);
    expect(api.requests).toHaveLength(1);
  });
});

describe('problems', () => {
  it('reads the code from the type slug, never the title', async () => {
    api.on(
      'GET',
      '/bookings',
      Reply.json(400, {
        type: 'https://lifepass.is/problems/invalid-cursor',
        title: 'Invalid cursor',
        status: 400,
        detail: 'Pagination cursor is invalid or malformed.',
        instance: '/api/v1/bookings',
        errors: [{ field: 'cursor', message: 'Invalid cursor' }],
      }),
    );
    const error = (await failure(client().get('/bookings'))) as ProblemError;
    expect(error).toBeInstanceOf(ProblemError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.slug).toBe('invalid-cursor');
    expect(error.code).toBe('invalid-cursor');
    expect(error.normalisedCode).toBe('invalid_cursor');
    expect(error.isProblem('invalid_cursor')).toBe(true);
    expect(error.isProblem('invalid-cursor')).toBe(true);
    expect(isProblem(error, 'other', 'invalid_cursor')).toBe(true);
    expect(isProblem(error, 'cursor')).toBe(false);
    expect(error.status).toBe(400);
    expect(error.details.errors).toEqual([{ field: 'cursor', message: 'Invalid cursor' }]);
    expect(error.details.instance).toBe('/api/v1/bookings');
  });

  it('carries the offer with its party, the reason and memberPricing', async () => {
    api.on(
      'POST',
      '/check-ins/walk-in',
      Reply.problem(402, 'charge_consent_required', {
        offer: {
          kind: 'surcharge',
          amountIsk: 4050,
          lane: 'premium',
          reason: 'guest_party',
          party: { ownAmountIsk: 0, guests: [{ band: 'child', count: 3, unitIsk: 1350 }] },
        },
      }),
    );
    const error = (await failure(client().post('/check-ins/walk-in', { venueId: 'v' }, { idempotencyKey: 'walkin-key-1' }))) as ProblemError;
    expect(error.status).toBe(402);
    expect(error.offer).toEqual({
      kind: 'surcharge',
      amountIsk: 4050,
      lane: 'premium',
      reason: 'guest_party',
      party: { ownAmountIsk: 0, guests: [{ band: 'child', count: 3, unitIsk: 1350 }] },
    });

    api.on('POST', '/bookings', Reply.problem(409, 'slot_unavailable', { reason: 'class_full' }));
    const slot = (await failure(client().post('/bookings', {}, { idempotencyKey: 'booking-key-1' }))) as ProblemError;
    expect(slot.reason).toBe('class_full');

    api.on('GET', '/health/today', Reply.problem(403, 'no_active_plan_or_pass', { memberPricing: 'company_covered' }));
    const gate = (await failure(client().get('/health/today'))) as ProblemError;
    expect(gate.memberPricing).toBe('company_covered');
  });

  it('reads the Coach free tier fail-soft', async () => {
    api.on(
      'POST',
      '/coach',
      Reply.problem(429, 'coach-free-limit', {
        freeMessages: { limit: 3, remaining: -1, windowDays: 30, resetsAt: '2026-10-20T00:00:00.000Z' },
        upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
      }),
    );
    const error = (await failure(client().post('/coach', { message: 'hi' }))) as ProblemError;
    expect(error.isProblem('coach_free_limit')).toBe(true);
    expect(error.freeMessages).toEqual({
      limit: 3,
      remaining: 0,
      windowDays: 30,
      resetsAt: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(error.upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/plans' });

    // A malformed count never costs the refusal.
    api.on(
      'POST',
      '/coach',
      Reply.problem(429, 'coach-free-limit', { freeMessages: { limit: 'three' }, upgrade: { url: 42 } }),
    );
    const soft = (await failure(client().post('/coach', { message: 'hi' }))) as ProblemError;
    expect(soft).toBeInstanceOf(ProblemError);
    expect(soft.freeMessages).toBeUndefined();
    expect(soft.upgrade).toBeUndefined();
  });

  it('reads the shipped members strictly: a malformed one is not a problem', async () => {
    api.on('GET', '/a', Reply.json(409, { type: 'https://lifepass.is/problems/x', status: '409' }));
    const status = await failure(client().get('/a'));
    expect(status).toBeInstanceOf(HttpStatusError);
    expect((status as HttpStatusError).status).toBe(409);

    api.on('GET', '/b', Reply.json(402, { type: 'https://lifepass.is/problems/charge_consent_required', offer: { kind: 'surcharge' } }));
    expect(await failure(client().get('/b'))).toBeInstanceOf(HttpStatusError);
  });

  it('a problem with no status of its own keeps none, as on iOS', async () => {
    // A proxy's own JSON error page: iOS reads it by `status ?? 0`.
    api.on('GET', '/a', Reply.json(504, { type: 'https://lifepass.is/problems/busy' }));
    const error = (await failure(client().get('/a'))) as ProblemError;
    expect(error).toBeInstanceOf(ProblemError);
    expect(error.status).toBeUndefined();
    expect(error.details.status).toBeUndefined();
    expect(error.httpStatus).toBe(504);
    expect(error.isRetryable).toBe(false);
    expect(error.messageIn('en')).toBe(translate('error.generic', 'en'));
    expect(refusalMessage(error)).toBe(translate('error.refusal_fallback', 'en'));
    expect(refusalFor(error)?.cta).toBeNull();
  });

  it('surfaces Retry-After and the request id', async () => {
    api.on('GET', '/a', Reply.problem(429, 'rate_limited', {}, { 'Retry-After': '30' }));
    expect(((await failure(client().get('/a'))) as ApiError).retryAfterSeconds).toBe(30);

    api.on(
      'GET',
      '/b',
      Reply.problem(500, 'internal_error', { errors: [{ field: 'requestId', message: 'req-in-body' }] }),
    );
    expect(((await failure(client().get('/b'))) as ApiError).requestId).toBe('req-in-body');

    api.on('GET', '/c', Reply.problem(500, 'internal_error', {}, { 'X-Request-Id': 'req-in-header' }));
    expect(((await failure(client().get('/c'))) as ApiError).requestId).toBe('req-in-header');
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter('Fri, 16 Oct 2026 12:01:30 GMT', now)).toBe(90);
    expect(parseRetryAfter('Fri, 16 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('statuses without a problem', () => {
  it('a 502 HTML page is an HttpStatusError, not a problem', async () => {
    api.on('POST', '/bookings', Reply.raw(502, '  <html><body>Bad gateway</body></html>  '));
    const error = (await failure(client().post('/bookings', {}, { idempotencyKey: 'booking-key-1' }))) as HttpStatusError;
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('http_502');
    expect(error.snippet).toBe('<html><body>Bad gateway</body></html>');
    expect(error.isRetryable).toBe(true);
    expect(isProblem(error, 'http_502')).toBe(false);
  });

  it('cuts a long body to 240 characters', async () => {
    api.on('GET', '/a', Reply.raw(504, 'x'.repeat(1000)));
    const error = (await failure(client().get('/a'))) as HttpStatusError;
    expect(error.snippet).toBe(`${'x'.repeat(240)}…`);
  });

  it('a 2xx that is not the envelope is a DecodingError', async () => {
    api.on('GET', '/a', Reply.raw(200, '<html>maintenance</html>'));
    expect(await failure(client().get('/a'))).toBeInstanceOf(DecodingError);
    api.on('GET', '/b', Reply.json(200, { value: 1 }));
    expect(await failure(client().get('/b'))).toBeInstanceOf(DecodingError);
    api.on('GET', '/c', Reply.json(200, [1, 2]));
    expect(await failure(client().get('/c'))).toBeInstanceOf(DecodingError);
  });
});

describe('transport', () => {
  it('a call that outlives its ceiling is a timeout', async () => {
    api.on('POST', '/bookings', Reply.hang());
    const error = (await failure(
      client().post('/bookings', {}, { idempotencyKey: 'booking-key-1', timeoutMs: 40 }),
    )) as TransportError;
    expect(error).toBeInstanceOf(TransportError);
    expect(error.transport).toBe('timeout');
    expect(error.isOffline).toBe(true);
    expect(error.isCancellation).toBe(false);
    expect(error.isRetryable).toBe(true);
    // The request was aborted, not left running.
    expect(api.sent('/bookings').signal.aborted).toBe(true);
  });

  it('every call has a default ceiling', async () => {
    api.on('GET', '/a', Reply.hang());
    const session = createStubApiClient({ defaultTimeoutMs: 30 });
    expect(((await failure(session.client.get('/a'))) as TransportError).transport).toBe('timeout');
  });

  it('Infinity is no ceiling at all', async () => {
    api.on('GET', '/a', Reply.delayed(30, Reply.ok({ slow: true })));
    const session = createStubApiClient({ defaultTimeoutMs: 5 });
    await expect(session.client.get('/a', undefined, { timeoutMs: Infinity })).resolves.toEqual({ slow: true });
  });

  it("the caller's abort is a cancellation, never offline", async () => {
    api.on('GET', '/a', Reply.hang());
    const controller = new AbortController();
    const pending = failure(client().get('/a', undefined, { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const error = (await pending) as TransportError;
    expect(error.transport).toBe('cancelled');
    expect(isCancellation(error)).toBe(true);
    expect(isOffline(error)).toBe(false);
  });

  it('an already aborted signal sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = (await failure(client().get('/a', undefined, { signal: controller.signal }))) as TransportError;
    expect(error.transport).toBe('cancelled');
    expect(api.requests).toHaveLength(0);
  });

  it('no network reads as offline, a failure with the phone online as network', async () => {
    api.on('GET', '/a', Reply.fail());
    const offline = createStubApiClient({ isDeviceOffline: async () => true });
    const error = (await failure(offline.client.get('/a'))) as TransportError;
    expect(error.transport).toBe('offline');
    expect(isOffline(error)).toBe(true);
    expect(isRetryable(error)).toBe(true);

    const online = (await failure(client().get('/a'))) as TransportError;
    expect(online.transport).toBe('network');
    expect(online.isOffline).toBe(true);
  });

  it("asks NetInfo by default", async () => {
    api.on('GET', '/a', Reply.fail());
    // Connected before the call; after it failed, the internet is out of reach.
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValueOnce({ isConnected: true, isInternetReachable: true } as never)
      .mockResolvedValueOnce({ isConnected: true, isInternetReachable: false } as never);
    const app = createApiClient({ accessToken: async () => 'test-token' });
    expect(((await failure(app.get('/a'))) as TransportError).transport).toBe('offline');
    expect(api.requests).toHaveLength(1);
  });
});

describe('ceilings by route', () => {
  // A stub whose default ceiling is 20 ms, and answers that take 60 ms.
  const slow = () => createStubApiClient({ defaultTimeoutMs: 20 }).client;

  it.each(['/bookings', '/check-ins/walk-in', '/bookings/payment-sessions/confirm'])(
    'POST %s waits as long as iOS (120 s) when its caller names no ceiling',
    async (path) => {
      api.on('POST', path, Reply.delayed(60, Reply.ok({ done: true })));
      await expect(slow().post(path, {}, { idempotencyKey: 'key-1' })).resolves.toEqual({ done: true });
    },
  );

  it('everything else keeps the default, the payment-session create included (as on iOS)', async () => {
    api.on('POST', '/bookings/payment-sessions', Reply.delayed(60, Reply.ok({ hasCard: true })));
    api.on('GET', '/bookings', Reply.delayed(60, Reply.ok([])));
    const create = (await failure(slow().post('/bookings/payment-sessions', {}, { idempotencyKey: 'k' }))) as TransportError;
    expect(create.transport).toBe('timeout');
    expect(((await failure(slow().get('/bookings'))) as TransportError).transport).toBe('timeout');
  });

  it("the caller's own ceiling wins", async () => {
    api.on('POST', '/bookings', Reply.delayed(60, Reply.ok({ done: true })));
    const error = (await failure(slow().post('/bookings', {}, { idempotencyKey: 'k', timeoutMs: 10 }))) as TransportError;
    expect(error.transport).toBe('timeout');
  });

  it('API_TIMEOUTS carries the iOS values', () => {
    expect(API_TIMEOUTS.bookingCreate).toBe(120_000);
    expect(API_TIMEOUTS.default).toBe(60_000);
  });
});

describe('the shared client', () => {
  afterEach(() => setSharedApiClient(null));

  it('apiGet and apiPost go through the installed client', async () => {
    installStubApiClient();
    api.on('GET', '/venues', Reply.ok([{ id: 'v1' }]));
    api.on('POST', '/favourites', Reply.ok({ ok: true }));
    await expect(apiGet('/venues', { limit: 5 })).resolves.toEqual([{ id: 'v1' }]);
    await expect(apiPost('/favourites', { venueId: 'v1' })).resolves.toEqual({ ok: true });
    expect(api.sent('/venues').query).toEqual({ limit: '5' });
    expect(api.sent('/favourites').headers.authorization).toBe('Bearer test-token');
  });

  it('with no session the app client fails fast (the stub Supabase has none)', async () => {
    const error = await failure(apiGet('/profile'));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect(api.requests).toHaveLength(0);
  });
});
