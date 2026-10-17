/**
 * The fetch the app's Supabase client should use for everything it sends
 * (F3 passes `createAuthFetch()` as `global.fetch` to `createClient`). It
 * changes only what supabase-js gets wrong for a phone, and only on the auth
 * server's routes; every other request goes through untouched.
 *
 * 1. A failing auth server must not sign anyone out. supabase-js keeps the
 *    session only when a refresh fails on the way or with 502, 503, 504 or a
 *    Cloudflare 52x. Any other failing answer (a GoTrue 500
 *    `unexpected_failure`, a 429 `over_request_rate_limit`) is an
 *    `AuthApiError`, and the SDK removes the session and fires SIGNED_OUT
 *    itself, before the API client is ever asked. iOS ends a session only
 *    when the auth server REFUSES it (the six codes in
 *    `REFUSED_REFRESH_CODES`): "an unreachable or failing auth server is not
 *    evidence of anything, and signing members out during a Supabase outage
 *    would be the wrong answer to it". So a refresh answered with a 429 or a
 *    5xx the SDK would not keep is handed to it as a 503, which it keeps. A
 *    4xx refusal is passed on as it came.
 *
 * 2. A refresh that fails is reported at once (`onRefreshTrouble`). The SDK
 *    retries a failing refresh with back-off for up to 30 s, holding its
 *    session lock the whole time, so every call reading the token waits as
 *    long; iOS fails at the first failure. The API client listens while it
 *    waits on the session and stops at the first failed attempt: offline or
 *    "network error" for a token read, the original 401 after a refresh.
 *    A call that STARTS while those retries are known to be failing
 *    (`knownRefreshTrouble`) fails at once too, instead of queueing on the
 *    lock for the SDK's next attempt.
 *
 * 3. Every request to the auth server has a ceiling (60 s, the URLSession
 *    default supabase-swift rides). React Native's fetch has none, and a
 *    refresh that never answers would hold the SDK's lock, and with it every
 *    session read, for good.
 */

/** Why a refresh failed: no answer at all, or an answer that was a failure (5xx, 429). */
export type RefreshTrouble = 'unreachable' | 'failing';

type TroubleListener = (trouble: RefreshTrouble) => void;

const listeners = new Set<TroubleListener>();

/** Called on every failed refresh attempt until the returned function unsubscribes. */
export function onRefreshTrouble(listener: TroubleListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How long after a failed refresh attempt the SDK may still be retrying it.
 * supabase-js waits 200 ms, then twice as long each time, up to 12.8 s
 * between two attempts inside its 30 s window; the margin is the next
 * attempt's own answer. Past this, with no attempt out, the SDK has given up
 * and the next session read starts afresh.
 */
export const REFRESH_RETRY_GAP_MS = 15_000;

/** The last failed refresh attempt, until a refresh answers or the SDK has stopped retrying. */
let latest: { readonly trouble: RefreshTrouble; readonly at: number } | null = null;
/** Refresh requests on the way now. */
let refreshesInFlight = 0;

/**
 * The trouble of the refresh supabase-js is retrying right now, or null. Set
 * by every failed attempt; cleared by a refresh (or any token grant) that
 * answers, and by the SDK having stopped: no attempt out and none failed for
 * `REFRESH_RETRY_GAP_MS`. While it is set, a session read would only queue
 * behind the SDK's lock for an attempt that will fail like the last one, so
 * the API client fails the call at once, as iOS fails each call at the first
 * failure.
 */
export function knownRefreshTrouble(now: number = Date.now()): RefreshTrouble | null {
  if (!latest) return null;
  if (refreshesInFlight > 0 || now - latest.at < REFRESH_RETRY_GAP_MS) return latest.trouble;
  latest = null;
  return null;
}

/** Forgets the last failed refresh. For tests. */
export function resetRefreshTrouble(): void {
  latest = null;
  refreshesInFlight = 0;
}

function report(trouble: RefreshTrouble): void {
  latest = { trouble, at: Date.now() };
  for (const listener of [...listeners]) {
    try {
      listener(trouble);
    } catch {
      // A listener's own failure must not change what the SDK sees.
    }
  }
}

/** The statuses supabase-js itself treats as an outage (auth-js NETWORK_ERROR_CODES). */
const SDK_KEEPS_SESSION: ReadonlySet<number> = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);

/** Default ceiling for a request to the auth server. */
export const AUTH_REQUEST_TIMEOUT_MS = 60_000;

export interface AuthFetchOptions {
  /** The fetch underneath, read per call (default the global one). */
  readonly fetch?: typeof fetch;
  /** Ceiling for each request to the auth server; `Infinity` for none. */
  readonly timeoutMs?: number;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (typeof (input as { url?: unknown }).url === 'string') return (input as { url: string }).url;
  return String(input);
}

/** A request to the Supabase auth server (`/auth/v1/...`). */
export function isAuthServerUrl(url: string): boolean {
  return /^[a-z]+:\/\/[^/]+\/auth\/v1\//i.test(url);
}

/** The session refresh: `POST /auth/v1/token?grant_type=refresh_token`. */
export function isRefreshTokenUrl(url: string): boolean {
  return /^[a-z]+:\/\/[^/]+\/auth\/v1\/token\?(?:[^#]*&)?grant_type=refresh_token(?:[&#]|$)/i.test(url);
}

/** Any token grant (`/auth/v1/token?...`): a refresh, a sign-in, a code exchange. */
function isTokenUrl(url: string): boolean {
  return /^[a-z]+:\/\/[^/]+\/auth\/v1\/token(?:[?#]|$)/i.test(url);
}

/** A refresh answer the SDK would wrongly end the session on. */
function endsSessionWrongly(status: number): boolean {
  return status === 429 || (status >= 500 && !SDK_KEEPS_SESSION.has(status));
}

export function createAuthFetch(options: AuthFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? AUTH_REQUEST_TIMEOUT_MS;
  const base = (...args: Parameters<typeof fetch>) => (options.fetch ?? fetch)(...args);

  return async (input, init) => {
    const url = urlOf(input);
    if (!isAuthServerUrl(url)) return base(input, init);
    const refresh = isRefreshTokenUrl(url);

    // The ceiling, joined with any signal the SDK passed (the phone's
    // AbortSignal has no `any`).
    const controller = new AbortController();
    const outer = init?.signal ?? undefined;
    const onOuterAbort = () => controller.abort();
    if (outer?.aborted) controller.abort();
    else outer?.addEventListener('abort', onOuterAbort);
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    if (refresh) {
      // A trouble left from a retry loop the SDK has since given up on must
      // not stand for this new attempt while it is out.
      knownRefreshTrouble();
      refreshesInFlight += 1;
    }
    let response: Response;
    try {
      response = await base(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (refresh) report('unreachable');
      throw error;
    } finally {
      if (refresh) refreshesInFlight = Math.max(0, refreshesInFlight - 1);
      if (timer !== undefined) clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }

    const failing = response.status >= 500 || response.status === 429;
    // The auth server answered a refresh (a session, or a refusal: either
    // way the SDK stops retrying), or issued a session some other way.
    if ((refresh && !failing) || (isTokenUrl(url) && response.ok)) latest = null;
    if (!refresh) return response;
    if (failing) report('failing');
    if (!endsSessionWrongly(response.status)) return response;
    const text = await response.text().catch(() => '');
    return new Response(text || null, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'x-lifepass-auth-status': String(response.status),
      },
    });
  };
}
