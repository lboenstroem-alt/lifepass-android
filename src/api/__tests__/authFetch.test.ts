/**
 * The fetch the Supabase client is to be given (../authFetch): what it
 * changes on the auth server's routes, and that it changes nothing else. The
 * end-to-end cases (the session kept, the 401 at once) are in auth.test.ts.
 */
import {
  AUTH_REQUEST_TIMEOUT_MS,
  createAuthFetch,
  isAuthServerUrl,
  isRefreshTokenUrl,
  knownRefreshTrouble,
  onRefreshTrouble,
  REFRESH_RETRY_GAP_MS,
  resetRefreshTrouble,
  type RefreshTrouble,
} from '../authFetch';

const BASE = 'https://project.supabase.test';
const REFRESH = `${BASE}/auth/v1/token?grant_type=refresh_token`;

function answering(status: number, body: unknown = { code: status, msg: 'x' }) {
  return jest.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

afterEach(() => resetRefreshTrouble());

function recordTrouble() {
  const seen: RefreshTrouble[] = [];
  const stop = onRefreshTrouble((trouble) => seen.push(trouble));
  return { seen, stop };
}

describe('which requests it touches', () => {
  it('knows the auth server and the refresh', () => {
    expect(isAuthServerUrl(`${BASE}/auth/v1/user`)).toBe(true);
    expect(isAuthServerUrl(`${BASE}/rest/v1/profiles`)).toBe(false);
    expect(isAuthServerUrl(`${BASE}/storage/v1/object/auth/v1/x`)).toBe(false);
    expect(isRefreshTokenUrl(REFRESH)).toBe(true);
    expect(isRefreshTokenUrl(`${BASE}/auth/v1/token?foo=1&grant_type=refresh_token`)).toBe(true);
    expect(isRefreshTokenUrl(`${BASE}/auth/v1/token?grant_type=password`)).toBe(false);
    expect(isRefreshTokenUrl(`${BASE}/auth/v1/token?grant_type=refresh_tokens`)).toBe(false);
    expect(isRefreshTokenUrl(`${BASE}/auth/v1/logout?scope=local`)).toBe(false);
  });

  it('passes every other request through as it came', async () => {
    const base = answering(500);
    const init = { method: 'GET' };
    const response = await createAuthFetch({ fetch: base })(`${BASE}/rest/v1/profiles`, init);
    expect(response.status).toBe(500);
    expect(base).toHaveBeenCalledWith(`${BASE}/rest/v1/profiles`, init);
  });
});

describe('a failing refresh', () => {
  let trouble: ReturnType<typeof recordTrouble>;
  beforeEach(() => {
    trouble = recordTrouble();
  });
  afterEach(() => trouble.stop());

  it.each([500, 501, 505, 429])('hands the SDK a %s as a 503, which it keeps the session on', async (status) => {
    const response = await createAuthFetch({ fetch: answering(status) })(REFRESH, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-lifepass-auth-status')).toBe(String(status));
    expect(await response.json()).toEqual({ code: status, msg: 'x' });
    expect(trouble.seen).toEqual(['failing']);
  });

  it.each([502, 503, 504, 522])('leaves a %s as it is (the SDK keeps the session on it already)', async (status) => {
    const response = await createAuthFetch({ fetch: answering(status) })(REFRESH, { method: 'POST' });
    expect(response.status).toBe(status);
    expect(trouble.seen).toEqual(['failing']);
  });

  it("passes the auth server's refusals and successes on untouched, and reports nothing", async () => {
    const refused = { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' };
    const response = await createAuthFetch({ fetch: answering(400, refused) })(REFRESH, { method: 'POST' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(refused);
    expect((await createAuthFetch({ fetch: answering(200) })(REFRESH, { method: 'POST' })).status).toBe(200);
    expect(trouble.seen).toEqual([]);
  });

  it('never rewrites any other auth request', async () => {
    const authFetch = createAuthFetch({ fetch: answering(500) });
    expect((await authFetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST' })).status).toBe(500);
    expect((await authFetch(`${BASE}/auth/v1/logout?scope=local`, { method: 'POST' })).status).toBe(500);
    expect(trouble.seen).toEqual([]);
  });

  it('reports a refresh that got no answer, and still fails it', async () => {
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(createAuthFetch({ fetch: offline })(REFRESH, { method: 'POST' })).rejects.toThrow(
      'Network request failed',
    );
    expect(trouble.seen).toEqual(['unreachable']);
  });

  it('a listener that throws changes nothing', async () => {
    const stop = onRefreshTrouble(() => {
      throw new Error('listener');
    });
    const response = await createAuthFetch({ fetch: answering(500) })(REFRESH, { method: 'POST' });
    stop();
    expect(response.status).toBe(503);
  });
});

describe('the ceiling on auth requests', () => {
  function hanging() {
    return jest.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
  }

  it('is 60 s, as the URLSession default supabase-swift rides', () => {
    expect(AUTH_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('aborts an auth request that never answers, so the SDK lock is freed', async () => {
    const trouble = recordTrouble();
    const authFetch = createAuthFetch({ fetch: hanging(), timeoutMs: 30 });
    await expect(authFetch(REFRESH, { method: 'POST' })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(authFetch(`${BASE}/auth/v1/user`, {})).rejects.toMatchObject({ name: 'AbortError' });
    trouble.stop();
    expect(trouble.seen).toEqual(['unreachable']);
  });

  it("still honours the SDK's own signal", async () => {
    const controller = new AbortController();
    const pending = createAuthFetch({ fetch: hanging(), timeoutMs: Infinity })(`${BASE}/auth/v1/user`, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('the refresh known to be failing', () => {
  it('is the last failed attempt, until a refresh answers', async () => {
    expect(knownRefreshTrouble()).toBeNull();
    await createAuthFetch({ fetch: answering(500) })(REFRESH, { method: 'POST' });
    expect(knownRefreshTrouble()).toBe('failing');
    await createAuthFetch({
      fetch: jest.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    })(REFRESH, { method: 'POST' }).catch(() => undefined);
    expect(knownRefreshTrouble()).toBe('unreachable');
    await createAuthFetch({ fetch: answering(200) })(REFRESH, { method: 'POST' });
    expect(knownRefreshTrouble()).toBeNull();
  });

  it("ends with the auth server's refusal (the SDK stops retrying) or any session it issues", async () => {
    await createAuthFetch({ fetch: answering(503) })(REFRESH, { method: 'POST' });
    await createAuthFetch({ fetch: answering(400) })(REFRESH, { method: 'POST' });
    expect(knownRefreshTrouble()).toBeNull();

    await createAuthFetch({ fetch: answering(429) })(REFRESH, { method: 'POST' });
    // A failed sign-in says nothing about the refresh; a session issued does.
    await createAuthFetch({ fetch: answering(400) })(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST' });
    expect(knownRefreshTrouble()).toBe('failing');
    await createAuthFetch({ fetch: answering(200) })(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST' });
    expect(knownRefreshTrouble()).toBeNull();
  });

  it('lapses once the SDK has stopped retrying, but not while an attempt is out', async () => {
    const started = Date.now();
    await createAuthFetch({ fetch: answering(500) })(REFRESH, { method: 'POST' });
    expect(knownRefreshTrouble(started + REFRESH_RETRY_GAP_MS - 1_000)).toBe('failing');

    // The next attempt is on the way (it may hang up to its own ceiling).
    let answer: (response: Response) => void = () => undefined;
    const pending = createAuthFetch({
      fetch: jest.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    })(REFRESH, { method: 'POST' });
    expect(knownRefreshTrouble(started + REFRESH_RETRY_GAP_MS + 60_000)).toBe('failing');
    answer(new Response('{}', { status: 502 }));
    await pending;

    // No attempt out and none failed for the gap: the SDK has given up.
    expect(knownRefreshTrouble(Date.now() + REFRESH_RETRY_GAP_MS)).toBeNull();
    expect(knownRefreshTrouble()).toBeNull();
  });

  it('is longer than the longest wait between two of the SDK\'s attempts (12.8 s)', () => {
    expect(REFRESH_RETRY_GAP_MS).toBeGreaterThan(12_800);
    expect(REFRESH_RETRY_GAP_MS).toBeLessThan(30_000);
  });
});
