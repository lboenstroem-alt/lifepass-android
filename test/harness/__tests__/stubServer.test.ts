/**
 * The stub server is the port of iOS `StubServer`: it must record exactly
 * what was sent, answer like the LifePass API answers, and never let a
 * request out of the process.
 */
import { api, http, HttpResponse, Reply, server, stubNetwork, supabase, TEST_API_BASE, TEST_SUPABASE_URL } from '@test/server';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${TEST_API_BASE}${path}`, init);
}

describe('recording', () => {
  it('records method, path (relative to /api/v1), query, headers and the JSON body', async () => {
    api.on('POST', '/check-ins/walk-in', Reply.ok({ checkInId: '9d7c1b2a-0000-4000-8000-000000000001' }));
    await call('/check-ins/walk-in?source=link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'walkin-key-1', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ venueId: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f', guestAgeBands: ['child'] }),
    });

    const sent = api.sent('/check-ins/walk-in');
    expect(sent.method).toBe('POST');
    expect(sent.host).toBe('api.lifepass.test');
    expect(sent.query).toEqual({ source: 'link' });
    expect(sent.headers['idempotency-key']).toBe('walkin-key-1');
    expect(sent.headers.authorization).toBe('Bearer test-token');
    expect(sent.body).toEqual({ venueId: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f', guestAgeBands: ['child'] });
    expect(sent.rawBody).toBe('{"venueId":"3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f","guestAgeBands":["child"]}');
  });

  it('keeps requests in order and finds the last one per path', async () => {
    api.respond = () => Reply.ok({});
    await call('/profile');
    await call('/venues?q=laug');
    await call('/profile', { method: 'POST', body: '{}' });
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /profile', 'GET /venues', 'POST /profile']);
    expect(api.sent('/profile').method).toBe('POST');
    expect(api.sent('/profile', 'GET').method).toBe('GET');
    expect(api.sentAll('/profile')).toHaveLength(2);
    expect(() => api.sent('/bookings')).toThrow(/nothing sent to \/bookings/);
  });

  it('records a request before answering it, so a responder can count', async () => {
    api.respond = () => Reply.ok({ seen: api.requests.length });
    expect(await (await call('/payments/status')).json()).toEqual({ ok: true, data: { seen: 1 } });
    expect(await (await call('/payments/status')).json()).toEqual({ ok: true, data: { seen: 2 } });
  });

  it('records plain data, so a failing assertion prints a normal diff', async () => {
    api.on('GET', '/venues/:venueId', Reply.ok({}));
    await call('/venues/abc?lang=is');
    const sent = api.sent('/venues/abc');
    // The live signal is there for responders, but not part of the data.
    expect(sent.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(sent)).not.toEqual(expect.arrayContaining(['signal']));
    expect(sent).toEqual({
      method: 'GET',
      url: `${TEST_API_BASE}/venues/abc?lang=is`,
      host: 'api.lifepass.test',
      path: '/venues/abc',
      query: { lang: 'is' },
      headers: expect.any(Object),
      body: undefined,
      rawBody: null,
      params: { venueId: 'abc' },
    });
    let message = '';
    try {
      expect(api.requests).toEqual([]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('expect(received).toEqual(expected)');
    expect(message).toContain('"path": "/venues/abc"');
    expect(message).not.toMatch(/incompatible receiver/);
  });

  it('starts every test empty', () => {
    expect(api.requests).toEqual([]);
  });
});

describe('replies', () => {
  it('answers an unrouted API request with a 500 internal_error problem, as iOS does', async () => {
    const res = await call('/anything');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toEqual({
      type: 'https://lifepass.is/problems/internal_error',
      title: 'internal_error',
      status: 500,
      detail: 'Server detail for internal_error.',
    });
  });

  it('builds problems the way the server does, with extra members', async () => {
    api.on('POST', '/bookings', Reply.problem(402, 'charge_consent_required', { offer: { kind: 'surcharge', amountIsk: 1500 } }));
    const res = await call('/bookings', { method: 'POST', body: '{}' });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      type: 'https://lifepass.is/problems/charge_consent_required',
      status: 402,
      offer: { kind: 'surcharge', amountIsk: 1500 },
    });
  });

  it('serves a raw gateway page and an empty answer', async () => {
    api.on('GET', '/venues', Reply.raw(502, '<html>Bad gateway</html>'));
    api.on('DELETE', '/favourites', Reply.empty());
    const page = await call('/venues');
    expect(page.status).toBe(502);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toBe('<html>Bad gateway</html>');
    const empty = await call('/favourites', { method: 'DELETE' });
    expect(empty.status).toBe(204);
  });

  it('fails the transport (offline) with a rejected fetch', async () => {
    api.on('GET', '/profile', Reply.fail());
    await expect(call('/profile')).rejects.toThrow();
  });

  it('hangs until the client gives up (a timeout)', async () => {
    api.on('GET', '/health', Reply.hang());
    const controller = new AbortController();
    const pending = call('/health', { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('delays an answer', async () => {
    api.on('GET', '/profile', Reply.delayed(20, Reply.ok({ late: true })));
    const started = Date.now();
    const res = await call('/profile');
    expect(await res.json()).toEqual({ ok: true, data: { late: true } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});

describe('routes', () => {
  it('matches named segments and passes them on', async () => {
    api.on('GET', '/venues/by-slug/:slug', (req) => Reply.ok({ slug: req.params.slug }));
    const res = await call('/venues/by-slug/sky-lagoon');
    expect(await res.json()).toEqual({ ok: true, data: { slug: 'sky-lagoon' } });
    expect(api.sent('/venues/by-slug/sky-lagoon').params).toEqual({ slug: 'sky-lagoon' });
  });

  it('lets a later route win, answers a `once` route once, and checks the method', async () => {
    api.on('GET', '/payments/status', Reply.ok({ status: 'awaiting_payment' }));
    api.once('GET', '/payments/status', Reply.ok({ status: 'pending' }));
    const first = await (await call('/payments/status')).json();
    const second = await (await call('/payments/status')).json();
    expect(first.data.status).toBe('pending');
    expect(second.data.status).toBe('awaiting_payment');
    expect((await call('/payments/status', { method: 'POST', body: '{}' })).status).toBe(500);
  });

  it('accepts a RegExp and a wildcard', async () => {
    api.on('*', /^\/health\/(?<rest>.+)$/, (req) => Reply.ok({ rest: req.params.rest }));
    api.on('GET', '/attractions/*', Reply.ok('sights'));
    expect((await (await call('/health/meals/days')).json()).data).toEqual({ rest: 'meals/days' });
    expect((await (await call('/attractions/trails')).json()).data).toBe('sights');
  });

  it('gives precedence to a raw msw handler added with server.use', async () => {
    server.use(http.get(`${TEST_API_BASE}/profile`, () => HttpResponse.json({ ok: true, data: { raw: true } })));
    expect((await (await call('/profile')).json()).data).toEqual({ raw: true });
  });
});

describe('Supabase', () => {
  it('records auth calls by full path and refuses unrouted ones with a 500', async () => {
    supabase.on('GET', '/auth/v1/settings', Reply.json(200, { external: { apple: true, google: false } }));
    const settings = await fetch(`${TEST_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: 'k' } });
    expect(await settings.json()).toEqual({ external: { apple: true, google: false } });
    expect(supabase.sent('/auth/v1/settings').headers.apikey).toBe('k');
    expect((await fetch(`${TEST_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).status).toBe(500);
  });
});

describe('the outside world', () => {
  it('refuses any other host and reports it', async () => {
    stubNetwork.allowStrayRequests();
    await expect(fetch('https://www.lifepass.is/api/v1/profile')).rejects.toThrow();
    await expect(fetch('https://api.open-meteo.com/v1/forecast')).rejects.toThrow();
    expect(stubNetwork.strayRequests()).toEqual([
      'GET https://www.lifepass.is/api/v1/profile',
      'GET https://api.open-meteo.com/v1/forecast',
    ]);
  });

  it('turns a stray request into a test failure', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow();
    expect(() => stubNetwork.assertNoStrayRequests()).toThrow(/hosts the stub server does not own[\s\S]*example\.com/);
    // Clear it so this test itself passes.
    stubNetwork.reset();
  });
});
