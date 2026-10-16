/**
 * The LifePass API client: the Android port of iOS `APIClient`
 * (Services/API/APIClient.swift). Every call to `/api/v1` goes through it.
 *
 * What it does, per docs/05_MOBILE_API.md:
 *   - Sends `Authorization: Bearer <supabase access token>` from the live
 *     Supabase session. Auth stays on Supabase; the API only validates the
 *     token. Nothing else is declared: no app-version, platform or
 *     API-version header (the version is in the path), only Accept,
 *     Content-Type, Idempotency-Key and the cache directive below.
 *   - Sends `Idempotency-Key` when the caller passes one (see ./idempotency:
 *     one key per user action, reused across retries).
 *   - Unwraps the `{ ok: true, data }` success envelope.
 *   - Turns a refusal into a typed error (./errors): a problem by its `type`
 *     slug, a non-problem status, a body that did not decode, or no answer
 *     at all (offline, timeout, cancelled), so a screen can tell "you are
 *     offline" from "the server said no".
 *   - Gives every step of a call a ceiling (60 s unless the caller says
 *     otherwise; React Native's fetch never times out on its own, and some
 *     routes can run for minutes server-side), and honours the caller's
 *     AbortSignal. The steps are reading the session token, the request, a
 *     refresh after a 401 and the resend, as iOS gives each its own timeout.
 *   - Fails at once on a phone with no network, before the auth SDK is
 *     touched: supabase-js would otherwise spend about 25 s retrying the
 *     refresh of an expired token first (iOS fails at once with
 *     `notConnectedToInternet`).
 *   - Recovers from one 401: refreshes the session once and resends a request
 *     that is safe to send twice (a GET, or a write carrying an
 *     Idempotency-Key). A refresh the auth server REFUSES, or a second 401,
 *     ends the session locally and the auth listener takes the app to
 *     sign-in. An unreachable auth server ends nothing: members are not signed
 *     out by an outage, and an offline phone reads as offline, never as
 *     "please sign in". (Two parts of that live in ./authFetch, the fetch the
 *     Supabase client must be given: supabase-js would sign a member out on
 *     a 500 or 429 refresh by itself, and it retries a failing refresh for
 *     up to 30 s where iOS gives up at once.)
 *
 * Apart from that one resend it never retries. Back-off on 429 (`Retry-After`,
 * surfaced as `error.retryAfterSeconds`) belongs to the caller, which knows
 * whether its operation is idempotent.
 *
 * The base URL is `env.apiBaseUrl` (src/config/env.ts): always the `www.` host,
 * because the apex 308-redirects to www and the Authorization header is
 * dropped on that cross-host redirect.
 */
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { env } from '../config/env';
import { supabase } from '../supabase/lib/client';

import { onRefreshTrouble, type RefreshTrouble } from './authFetch';
import { deviceDisconnected, deviceOffline } from './connectivity';
import {
  ApiError,
  DecodingError,
  decodeProblemDetails,
  HttpStatusError,
  NotAuthenticatedError,
  ProblemError,
  TransportError,
  type ChargeConsentOffer,
  type ResponseMeta,
} from './errors';
import { encodeBody, snippet, stringifySorted } from './wire';

// Kept for the screens written against the first client.
export { ApiError };
export type ChargeOffer = ChargeConsentOffer;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Whether a call needs a signed-in member. Almost every route does, so
 * `required` is the default: with no session it fails fast with
 * `NotAuthenticatedError` instead of sending a request the API would 401.
 * `optional` is for the public attraction feeds, which a tourist with no
 * account must see: the token is sent when there is one, and nothing fails
 * without it.
 */
export type AuthMode = 'required' | 'optional';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Readonly<Record<string, QueryValue | readonly (string | number | boolean)[]>>;

/**
 * Per-call ceilings iOS uses, for the call sites that port them. Everything
 * else gets `DEFAULT_TIMEOUT_MS`, the iOS session default.
 */
export const API_TIMEOUTS = {
  default: 60_000,
  profile: 60_000,
  /** Health reads and writes (a Today read must not hang). */
  health: 20_000,
  /** The health client's session default. */
  healthSession: 30_000,
  /** A photo or text meal estimate waits on a model. */
  mealScan: 20_000,
  /** POST /bookings and the payment-session confirm: the venue's system is in the loop. */
  bookingCreate: 120_000,
} as const;

export const DEFAULT_TIMEOUT_MS = API_TIMEOUTS.default;

/**
 * The writes iOS gives `BookingService.createTimeout` (120 s): the booking
 * create, the walk-in and the payment-session confirm, where the venue's
 * system is in the loop. A call to one of them that names no ceiling of its
 * own gets `API_TIMEOUTS.bookingCreate`, so the legacy services
 * (src/supabase/services/{bookings,checkin}.ts) do not tell a member a
 * booking failed at 60 s while the server is still making it. BOOK-1,
 * CHECKIN-2 and F8, which replace those call sites, pass the value
 * themselves, as iOS does; this stays as the floor for anything that
 * forgets. (The payment-session CREATE keeps the default, as on iOS.)
 */
const LONG_WRITES: ReadonlySet<string> = new Set([
  'POST /bookings',
  'POST /check-ins/walk-in',
  'POST /bookings/payment-sessions/confirm',
]);

/** The ceiling a call gets when its caller names none. */
function routeTimeoutMs(method: HttpMethod, path: string): number | undefined {
  const route = `/${path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '')}`;
  return LONG_WRITES.has(`${method} ${route}`) ? API_TIMEOUTS.bookingCreate : undefined;
}

export interface RequestOptions<T = unknown> {
  /** Query items; `undefined`, `null` and `''` are left out, an array repeats the key. */
  readonly query?: Query;
  /** Default `required`. */
  readonly auth?: AuthMode;
  /**
   * The ceiling in milliseconds for each step of the call (default 60 000;
   * 120 000 for the long writes in `LONG_WRITES`); `Infinity` for none. The
   * steps are reading the session token, the request with its answer's body,
   * a refresh after a 401, and the resend. Ends in
   * `TransportError('timeout')`, with the session kept. (iOS's per-request
   * timeout is an idle timeout; a ceiling is what fetch can offer, and every
   * iOS value is far above a normal answer.)
   */
  readonly timeoutMs?: number;
  /** One key per user action, reused across retries (./idempotency). */
  readonly idempotencyKey?: string;
  /** The caller's cancellation (a screen closing). Ends in `TransportError('cancelled')`. */
  readonly signal?: AbortSignal;
  /**
   * `no-store` (the default for authenticated calls) asks the HTTP layer
   * never to keep the answer: React Native's Android networking has a disk
   * cache, and member data, health values above all, must never land in it.
   * Sent as the `Cache-Control: no-store` request header, which OkHttp's
   * cache honours. (Not fetch's `cache` option: React Native's fetch
   * implements that by appending `_=<timestamp>` to the URL, a query
   * parameter the API does not declare.) `default` lets public, cacheable
   * feeds be cached.
   */
  readonly cache?: 'no-store' | 'default';
  /**
   * Reads the envelope's `data` into the caller's type. Anything it throws
   * becomes a `DecodingError` (with the body's first 240 characters for
   * diagnostics). Without it, `data` is returned as is.
   */
  readonly decode?: (data: unknown) => T;
}

export interface DeleteOptions<T = unknown> extends RequestOptions<T> {
  /** DELETE with a JSON body (a few routes take one). */
  readonly body?: unknown;
}

export interface ApiClient {
  get<T = unknown>(path: string, query?: Query, options?: RequestOptions<T>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  put<T = unknown>(path: string, body: unknown, options?: RequestOptions<T>): Promise<T>;
  patch<T = unknown>(path: string, body: unknown, options?: RequestOptions<T>): Promise<T>;
  delete<T = unknown>(path: string, query?: Query, options?: DeleteOptions<T>): Promise<T>;
  /**
   * The `data` of a GET as JSON text with every key kept, sorted, indented:
   * for the data export (`GET /account/export`) only. The export is a
   * member's own copy of everything LifePass holds; reading it into an app
   * type would silently drop any field the app does not model, the one thing
   * a subject-access copy must never do.
   */
  getRawData(path: string, query?: Query, options?: Omit<RequestOptions<unknown>, 'decode'>): Promise<string>;
  /** Any verb, for the rare call the helpers above do not fit. */
  request<T = unknown>(method: HttpMethod, path: string, options?: DeleteOptions<T>): Promise<T>;
}

/**
 * Where the client gets what it needs. The app uses the Supabase session and
 * the real network; a test passes its own (the iOS `APIClient.init`
 * closures).
 */
export interface ApiClientDeps {
  /** `/api/v1` base, read per call (default `env.apiBaseUrl`). */
  readonly baseUrl?: () => string;
  /**
   * The bearer token, or null with no session. Throw a `TransportError` when
   * the token could not be read because the phone is offline: that member is
   * offline, not signed out.
   */
  readonly accessToken?: () => Promise<string | null>;
  /**
   * Forces a refresh after a 401 and answers the new token. Throw
   * `RefreshRefusedError` when the auth server refused it (the session is
   * gone); any other failure keeps the session.
   */
  readonly refreshAccessToken?: () => Promise<string | null>;
  /** Ends a session the server no longer accepts (Supabase `signOut({ scope: 'local' })`). */
  readonly endRevokedSession?: () => Promise<void>;
  readonly fetch?: typeof fetch;
  /**
   * After a call failed on the way: true when the phone has no network
   * (tells `offline` from `network`).
   */
  readonly isDeviceOffline?: () => Promise<boolean>;
  /**
   * Before a call: true only when the phone has no network connection at all
   * (NetInfo `isConnected === false`). A required route then fails as
   * offline at once, without asking the auth SDK for a token it would spend
   * about 25 s failing to refresh.
   */
  readonly isDeviceDisconnected?: () => Promise<boolean>;
  /**
   * Subscribes to failed session refreshes (./authFetch). While a call waits
   * on the session, the first failed refresh attempt ends the wait, as iOS
   * fails at the first failure instead of riding out supabase-js's retries.
   */
  readonly onRefreshTrouble?: (listener: (trouble: RefreshTrouble) => void) => () => void;
  readonly defaultTimeoutMs?: number;
}

/**
 * The auth server REFUSED the refresh: the session is gone (revoked, signed
 * out everywhere, the user deleted or banned). Only this ends a session
 * locally.
 */
export class RefreshRefusedError extends Error {
  constructor(cause?: unknown) {
    super('refresh refused');
    this.name = 'RefreshRefusedError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** The auth server's own words for "this session no longer exists". */
export const REFUSED_REFRESH_CODES: ReadonlySet<string> = new Set([
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
  'user_banned',
]);

/**
 * True when a Supabase refresh error means the session is gone. An
 * unreachable or failing auth server (a network error, a 5xx) is not evidence
 * of anything, and signing members out during an outage would be the wrong
 * answer to it; neither is an error that did not come from the auth SDK.
 */
export function refreshRefused(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  return typeof error.code === 'string' && REFUSED_REFRESH_CODES.has(error.code);
}

// ---------------------------------------------------------------------------
// The Supabase side

/**
 * How long ending a revoked session waits for the auth server to hear about
 * it before ending it on the phone anyway.
 */
export const LOGOUT_WAIT_MS = 10_000;

type SessionDeps = Required<Pick<ApiClientDeps, 'accessToken' | 'refreshAccessToken' | 'endRevokedSession'>>;

/**
 * The client's session functions on `client` (the app's Supabase client by
 * default; a test passes its own). The iOS `APIClient.init` defaults.
 */
export function supabaseSessionDeps(client: SupabaseClient = supabase): SessionDeps {
  return {
    /**
     * The live session's access token (supabase-js refreshes an expired one
     * first). A refresh that failed because the auth server could not be
     * reached is a transport failure, never "no session".
     */
    async accessToken() {
      const { data, error } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (token) return token;
      if (error && isAuthRetryableFetchError(error)) {
        const offline = !error.status && (await deviceOffline());
        throw new TransportError(offline ? 'offline' : 'network', error);
      }
      return null;
    },

    /** Refreshes the session; a refused refresh throws `RefreshRefusedError`. */
    async refreshAccessToken() {
      const { data, error } = await client.auth.refreshSession();
      if (error) {
        if (refreshRefused(error)) throw new RefreshRefusedError(error);
        throw error;
      }
      return data.session?.access_token ?? null;
    },

    /**
     * Ends the session on this phone, whatever the auth server says. The
     * SIGNED_OUT event takes the app to sign-in.
     *
     * supabase-js's `signOut({ scope: 'local' })` asks the auth server first
     * and KEEPS the session when that request fails on the way or with a
     * 5xx (it returns `{ error }`, it does not throw). supabase-swift removes
     * the session before it asks, so on iOS a failed logout still ends it.
     * Here a logout that failed, threw, or did not answer within
     * `LOGOUT_WAIT_MS` is followed by the SDK's own local removal, which
     * clears the stored session and emits SIGNED_OUT.
     */
    async endRevokedSession() {
      let ended = false;
      try {
        const result = await settleWithin(client.auth.signOut({ scope: 'local' }), LOGOUT_WAIT_MS);
        ended = result !== undefined && !result.error;
      } catch {
        ended = false;
      }
      if (!ended) await removeSessionLocally(client);
    },
  };
}

/**
 * supabase-js's own local removal (`_removeSession`: clears the stored
 * session and notifies SIGNED_OUT). Not public API, so it is feature-checked,
 * and src/api/__tests__/auth.test.ts fails on an SDK upgrade that drops it.
 */
async function removeSessionLocally(client: SupabaseClient): Promise<void> {
  const auth = client.auth as unknown as { _removeSession?: () => Promise<void> };
  if (typeof auth._removeSession !== 'function') return;
  try {
    await auth._removeSession.call(client.auth);
  } catch {
    // Nothing more can be done from here.
  }
}

/** `work`'s value, or `undefined` when it has not settled within `ms`. */
function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The app session's access token (see `supabaseSessionDeps`). */
export function supabaseAccessToken(): Promise<string | null> {
  return supabaseSessionDeps().accessToken();
}

/** Refreshes the app session; a refused refresh throws `RefreshRefusedError`. */
export function supabaseRefreshAccessToken(): Promise<string | null> {
  return supabaseSessionDeps().refreshAccessToken();
}

/** Ends the app session on this phone only. The SIGNED_OUT event takes the app to sign-in. */
export function supabaseEndRevokedSession(): Promise<void> {
  return supabaseSessionDeps().endRevokedSession();
}

// ---------------------------------------------------------------------------
// The client

interface Prepared {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

interface Answer {
  readonly status: number;
  readonly text: string;
  readonly meta: ResponseMeta;
}

/** Options with the ceiling settled (the caller's, the route's, or the default). */
type CallOptions<T> = DeleteOptions<T> & { readonly timeoutMs: number };

/**
 * How a wait on the auth SDK ended: its answer, a failed refresh reported
 * while waiting (./authFetch), or the call's own limits.
 */
type AuthWait<T> =
  | { readonly value: T }
  | { readonly trouble: RefreshTrouble }
  | { readonly stopped: 'timeout' | 'cancelled' };

/** Several calls that hit the same 401 share one refresh. */
interface SharedRefresh {
  readonly result: Promise<string | null>;
  /** The first failed attempt reported while it ran, if any. */
  trouble: RefreshTrouble | null;
}

export function createApiClient(deps: ApiClientDeps = {}): ApiClient {
  const baseUrl = deps.baseUrl ?? (() => env.apiBaseUrl);
  const accessToken = deps.accessToken ?? supabaseAccessToken;
  const refreshAccessToken = deps.refreshAccessToken ?? supabaseRefreshAccessToken;
  const endRevokedSession = deps.endRevokedSession ?? supabaseEndRevokedSession;
  const isDeviceOffline = deps.isDeviceOffline ?? deviceOffline;
  const isDeviceDisconnected = deps.isDeviceDisconnected ?? deviceDisconnected;
  const subscribeTrouble = deps.onRefreshTrouble ?? onRefreshTrouble;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Read per call so a test that installs its own fetch reaches the client.
  const fetchImpl = (...args: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...args);

  // Several calls can hit the same 401 at once (a screen loading three
  // things): they share one refresh rather than rotating the token N times.
  let refreshing: SharedRefresh | null = null;
  function refreshOnce(): SharedRefresh {
    if (refreshing) return refreshing;
    const entry: { result: Promise<string | null>; trouble: RefreshTrouble | null } = {
      result: Promise.resolve(null),
      trouble: null,
    };
    // A call that joins a refresh already known to be failing fails at once
    // too, rather than waiting for the SDK's next attempt.
    const unsubscribe = subscribeTrouble((trouble) => {
      entry.trouble ??= trouble;
    });
    entry.result = Promise.resolve()
      .then(() => refreshAccessToken())
      .finally(() => {
        unsubscribe();
        if (refreshing === entry) refreshing = null;
      });
    // Every caller may have stopped waiting (a failed attempt, a cancel):
    // the refresh's own failure must not surface as an unhandled rejection.
    entry.result.catch(() => undefined);
    refreshing = entry;
    return entry;
  }

  async function endSession(): Promise<void> {
    try {
      await endRevokedSession();
    } catch {
      // The session is unusable either way; the caller is told to sign in.
    }
  }

  /**
   * Waits on the auth SDK (a token read, a refresh) within the step's
   * ceiling and the caller's signal, and stops at the first failed refresh
   * attempt reported meanwhile. Giving up never touches the session: the
   * SDK's own work carries on and settles in the background.
   *
   * supabase-js serialises every session read behind one lock, and retries a
   * failing refresh with back-off for up to 30 s while holding it; its
   * auto-refresh ticker can queue the next 30 s right behind. Without this
   * bound a call could wait on that queue indefinitely.
   */
  function waitForAuth<T>(
    work: () => Promise<T>,
    ceilingMs: number,
    signal: AbortSignal | undefined,
    knownTrouble: RefreshTrouble | null = null,
  ): Promise<AuthWait<T>> {
    return new Promise<AuthWait<T>>((resolve, reject) => {
      let done = false;
      const cleanups: (() => void)[] = [];
      const finish = (settle: () => void) => {
        if (done) return;
        done = true;
        for (const cleanup of cleanups) {
          try {
            cleanup();
          } catch {
            // A failing unsubscribe must not change the answer.
          }
        }
        settle();
      };
      if (signal?.aborted) return finish(() => resolve({ stopped: 'cancelled' }));
      if (knownTrouble) return finish(() => resolve({ trouble: knownTrouble }));
      cleanups.push(subscribeTrouble((trouble) => finish(() => resolve({ trouble }))));
      // `Infinity` (or 0) means no ceiling; a timer that large would overflow.
      if (Number.isFinite(ceilingMs) && ceilingMs > 0) {
        const timer = setTimeout(() => finish(() => resolve({ stopped: 'timeout' })), ceilingMs);
        cleanups.push(() => clearTimeout(timer));
      }
      if (signal) {
        const onAbort = () => finish(() => resolve({ stopped: 'cancelled' }));
        signal.addEventListener('abort', onAbort);
        cleanups.push(() => signal.removeEventListener('abort', onAbort));
      }
      let pending: Promise<T>;
      try {
        pending = work();
      } catch (error) {
        return finish(() => reject(error));
      }
      pending.then(
        (value) => finish(() => resolve({ value })),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  async function send<T>(method: HttpMethod, path: string, callerOptions: DeleteOptions<T>): Promise<T> {
    const options: CallOptions<T> = {
      ...callerOptions,
      timeoutMs: callerOptions.timeoutMs ?? routeTimeoutMs(method, path) ?? defaultTimeoutMs,
    };
    const auth = options.auth ?? 'required';
    if (options.signal?.aborted) throw new TransportError('cancelled');

    const token = await readToken(auth, options);
    if (!token && auth === 'required') throw new NotAuthenticatedError();

    const prepared = prepare(method, path, options, token);
    const answer = await perform(prepared, options);
    if (answer.status === 401 && auth === 'required') {
      return recoverFromUnauthorized(prepared, answer, options);
    }
    return decodeAnswer(answer, options.decode);
  }

  /**
   * The bearer token. For `required` routes a missing session fails fast
   * (the caller throws `NotAuthenticatedError`); for `optional` ones whatever
   * we have is sent, and the route decides.
   */
  async function readToken(auth: AuthMode, options: CallOptions<unknown>): Promise<string | null> {
    // No network at all: offline, before the auth SDK is asked. An expired
    // token would otherwise be refreshed first, and supabase-js retries that
    // refresh for about 25 s before it gives up; iOS fails at once. An
    // optional route goes out without a token and fails (or not) by itself.
    if (await isDeviceDisconnected()) {
      if (auth === 'required') throw new TransportError('offline');
      return null;
    }
    let waited: AuthWait<string | null>;
    try {
      waited = await waitForAuth(accessToken, options.timeoutMs, options.signal);
    } catch (error) {
      // An expired token that could not be refreshed because the phone is
      // offline: that member is offline, not signed out, and "Please sign
      // in" would send them to a sign-in that cannot work either.
      if (auth === 'required' && error instanceof TransportError) throw error;
      return null;
    }
    if ('value' in waited) return waited.value;
    if ('stopped' in waited) {
      if (auth === 'required' || waited.stopped === 'cancelled') throw new TransportError(waited.stopped);
      return null;
    }
    // The expired token's refresh failed while we waited: the auth server
    // could not be reached, or is failing.
    if (auth === 'optional') return null;
    const offline = waited.trouble === 'unreachable' && (await isDeviceOffline());
    throw new TransportError(offline ? 'offline' : 'network');
  }

  /**
   * One 401 on an authenticated route. The server checks the session itself,
   * so a session revoked elsewhere (a password reset, "sign out everywhere")
   * is refused here long before the token's own expiry. Refresh once: a
   * refresh the auth server refuses means the session is gone, so end it. A
   * refreshed token resends a request that is safe to send twice; a second
   * 401 with a fresh token ends the session too.
   */
  async function recoverFromUnauthorized<T>(
    prepared: Prepared,
    first: Answer,
    options: CallOptions<T>,
  ): Promise<T> {
    const refusal = errorFor(first);
    let waited: AuthWait<string | null>;
    try {
      const shared = refreshOnce();
      waited = await waitForAuth(() => shared.result, options.timeoutMs, options.signal, shared.trouble);
    } catch (error) {
      if (error instanceof RefreshRefusedError) {
        await endSession();
        throw new NotAuthenticatedError();
      }
      // Offline, or the auth server failing: nothing is known about the
      // session, so it is kept and this request fails as it came.
      throw refusal;
    }
    // The caller's cancel or the step's ceiling: the session is kept.
    if ('stopped' in waited) throw new TransportError(waited.stopped);
    // A refresh attempt failed (unreachable, 5xx, 429): as on iOS, this
    // request fails as it came at once, the session kept, while the SDK's
    // own retries carry on in the background.
    if ('trouble' in waited) throw refusal;
    const fresh = waited.value;
    if (!fresh) {
      await endSession();
      throw new NotAuthenticatedError();
    }
    if (!(prepared.method === 'GET' || options.idempotencyKey)) throw refusal;

    const retry: Prepared = {
      ...prepared,
      headers: { ...prepared.headers, Authorization: `Bearer ${fresh}` },
    };
    const second = await perform(retry, options);
    if (second.status === 401) {
      await endSession();
      throw new NotAuthenticatedError();
    }
    return decodeAnswer(second, options.decode);
  }

  function prepare(method: HttpMethod, path: string, options: DeleteOptions<unknown>, token: string | null): Prepared {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const cache = options.cache ?? ((options.auth ?? 'required') === 'required' ? 'no-store' : 'default');
    if (cache === 'no-store') headers['Cache-Control'] = 'no-store';
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = encodeBody(options.body);
    }
    return { url: buildUrl(baseUrl(), path, options.query), method, headers, body };
  }

  async function perform(prepared: Prepared, options: RequestOptions<unknown>): Promise<Answer> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    // `Infinity` (or 0) means no ceiling; a timer that large would overflow
    // and fire at once.
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const callerSignal = options.signal;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);
    try {
      if (callerSignal?.aborted) throw new TransportError('cancelled');
      const response = await fetchImpl(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
        signal: controller.signal,
      });
      // The body is read inside the ceiling too: a stalled body is a timeout.
      const text = await response.text();
      return { status: response.status, text, meta: responseMeta(response.headers) };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (timedOut) throw new TransportError('timeout', error);
      if (callerSignal?.aborted || isAbortError(error)) throw new TransportError('cancelled', error);
      // React Native's own XHR timeout ("Network request timed out").
      if (error instanceof Error && /timed out/i.test(error.message)) throw new TransportError('timeout', error);
      throw new TransportError((await isDeviceOffline()) ? 'offline' : 'network', error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  const client: ApiClient = {
    get: (path, query, options = {}) => send('GET', path, { ...options, query: mergeQuery(query, options.query) }),
    post: (path, body, options = {}) => send('POST', path, { ...options, body }),
    put: (path, body, options = {}) => send('PUT', path, { ...options, body }),
    patch: (path, body, options = {}) => send('PATCH', path, { ...options, body }),
    delete: (path, query, options = {}) => send('DELETE', path, { ...options, query: mergeQuery(query, options.query) }),
    async getRawData(path, query, options = {}) {
      const data = await send<unknown>('GET', path, { ...options, query: mergeQuery(query, options.query) });
      return stringifySorted(data);
    },
    request: (method, path, options = {}) => send(method, path, options),
  };
  return client;
}

// ---------------------------------------------------------------------------
// Answers

function decodeAnswer<T>(answer: Answer, decode: ((data: unknown) => T) | undefined): T {
  if (answer.status >= 200 && answer.status < 300) {
    let json: unknown;
    try {
      json = JSON.parse(answer.text);
    } catch (error) {
      throw new DecodingError(snippet(answer.text), error);
    }
    if (!isEnvelope(json)) throw new DecodingError(snippet(answer.text));
    if (!decode) return json.data as T;
    try {
      return decode(json.data);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new DecodingError(snippet(answer.text), error);
    }
  }
  throw errorFor(answer);
}

/** The error for a non-2xx: the structured problem when the body is one. */
function errorFor(answer: Answer): ApiError {
  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch {
    return new HttpStatusError(answer.status, snippet(answer.text), answer.meta);
  }
  const problem = decodeProblemDetails(json);
  if (problem) return new ProblemError(problem, answer.status, answer.meta);
  return new HttpStatusError(answer.status, snippet(answer.text), answer.meta);
}

function isEnvelope(json: unknown): json is { ok: boolean; data: unknown } {
  return (
    typeof json === 'object' &&
    json !== null &&
    !Array.isArray(json) &&
    typeof (json as { ok?: unknown }).ok === 'boolean' &&
    'data' in json
  );
}

function responseMeta(headers: Headers): ResponseMeta {
  return {
    retryAfterSeconds: parseRetryAfter(headers.get('retry-after')),
    requestId: headers.get('x-request-id') ?? undefined,
  };
}

/** `Retry-After` as whole seconds: delta-seconds, or an HTTP date counted from now. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

// ---------------------------------------------------------------------------
// URLs

function mergeQuery(a: Query | undefined, b: Query | undefined): Query | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

/**
 * `base` + `path` (with or without its leading slash) + the query string,
 * built by hand: React Native's own URL has no working `searchParams`.
 */
export function buildUrl(base: string, path: string, query?: Query): string {
  const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values as readonly QueryValue[]) {
      if (item === undefined || item === null || item === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  if (!parts.length) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

// ---------------------------------------------------------------------------
// The app's client

let sharedClient: ApiClient | null = null;

function shared(): ApiClient {
  return (sharedClient ??= createApiClient());
}

/**
 * The app's client: the live Supabase session and the real network. Every
 * `api*` helper below goes through it. A test swaps it with
 * `setSharedApiClient` (see ./testing), as iOS tests hand a service a client
 * built on the stub server.
 */
export const apiClient: ApiClient = {
  get: (path, query, options) => shared().get(path, query, options),
  post: (path, body, options) => shared().post(path, body, options),
  put: (path, body, options) => shared().put(path, body, options),
  patch: (path, body, options) => shared().patch(path, body, options),
  delete: (path, query, options) => shared().delete(path, query, options),
  getRawData: (path, query, options) => shared().getRawData(path, query, options),
  request: (method, path, options) => shared().request(method, path, options),
};

/**
 * Replaces the client behind `apiClient` and the `api*` helpers; `null` goes
 * back to the app's own. For tests and debug fixtures only.
 */
export function setSharedApiClient(client: ApiClient | null): void {
  sharedClient = client;
}

/** GET `path`. `query` items that are `undefined`, `null` or `''` are left out. */
export function apiGet<T = unknown>(path: string, query?: Query, options?: RequestOptions<T>): Promise<T> {
  return apiClient.get<T>(path, query, options);
}

export function apiPost<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> {
  return apiClient.post<T>(path, body, options);
}

export function apiPut<T = unknown>(path: string, body: unknown, options?: RequestOptions<T>): Promise<T> {
  return apiClient.put<T>(path, body, options);
}

export function apiPatch<T = unknown>(path: string, body: unknown, options?: RequestOptions<T>): Promise<T> {
  return apiClient.patch<T>(path, body, options);
}

/** DELETE `path`, optionally with a JSON body (`options.body`). */
export function apiDelete<T = unknown>(path: string, query?: Query, options?: DeleteOptions<T>): Promise<T> {
  return apiClient.delete<T>(path, query, options);
}

/** `GET /account/export` and the like: every key kept (see `ApiClient.getRawData`). */
export function apiGetRawData(
  path: string,
  query?: Query,
  options?: Omit<RequestOptions<unknown>, 'decode'>,
): Promise<string> {
  return apiClient.getRawData(path, query, options);
}
