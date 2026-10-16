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
 *   - Gives every call a ceiling (60 s unless the caller says otherwise; React
 *     Native's fetch never times out on its own, and some routes can run for
 *     minutes server-side), and honours the caller's AbortSignal.
 *   - Recovers from one 401: refreshes the session once and resends a request
 *     that is safe to send twice (a GET, or a write carrying an
 *     Idempotency-Key). A refresh the auth server REFUSES, or a second 401,
 *     ends the session locally and the auth listener takes the app to
 *     sign-in. An unreachable auth server ends nothing: members are not signed
 *     out by an outage, and an offline phone reads as offline, never as
 *     "please sign in".
 *
 * Apart from that one resend it never retries. Back-off on 429 (`Retry-After`,
 * surfaced as `error.retryAfterSeconds`) belongs to the caller, which knows
 * whether its operation is idempotent.
 *
 * The base URL is `env.apiBaseUrl` (src/config/env.ts): always the `www.` host,
 * because the apex 308-redirects to www and the Authorization header is
 * dropped on that cross-host redirect.
 */
import NetInfo from '@react-native-community/netinfo';
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';

import { env } from '../config/env';
import { supabase } from '../supabase/lib/client';

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

export interface RequestOptions<T = unknown> {
  /** Query items; `undefined`, `null` and `''` are left out, an array repeats the key. */
  readonly query?: Query;
  /** Default `required`. */
  readonly auth?: AuthMode;
  /** The call's ceiling in milliseconds (default 60 000). Ends in `TransportError('timeout')`. */
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
  /** True when the phone has no network (tells `offline` from `network`). */
  readonly isDeviceOffline?: () => Promise<boolean>;
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

async function deviceOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

/**
 * The live session's access token (supabase-js refreshes an expired one
 * first). A refresh that failed because the auth server could not be reached
 * is a transport failure, never "no session".
 */
export async function supabaseAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) return token;
  if (error && isAuthRetryableFetchError(error)) {
    const offline = !error.status && (await deviceOffline());
    throw new TransportError(offline ? 'offline' : 'network', error);
  }
  return null;
}

/** Refreshes the session; a refused refresh throws `RefreshRefusedError`. */
export async function supabaseRefreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    if (refreshRefused(error)) throw new RefreshRefusedError(error);
    throw error;
  }
  return data.session?.access_token ?? null;
}

/** Ends the session on this phone only. The `SIGNED_OUT` event takes the app to sign-in. */
export async function supabaseEndRevokedSession(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing more to do: the session is already unusable.
  }
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

export function createApiClient(deps: ApiClientDeps = {}): ApiClient {
  const baseUrl = deps.baseUrl ?? (() => env.apiBaseUrl);
  const accessToken = deps.accessToken ?? supabaseAccessToken;
  const refreshAccessToken = deps.refreshAccessToken ?? supabaseRefreshAccessToken;
  const endRevokedSession = deps.endRevokedSession ?? supabaseEndRevokedSession;
  const isDeviceOffline = deps.isDeviceOffline ?? deviceOffline;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Read per call so a test that installs its own fetch reaches the client.
  const fetchImpl = (...args: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...args);

  // Several calls can hit the same 401 at once (a screen loading three
  // things): they share one refresh rather than rotating the token N times.
  let refreshing: Promise<string | null> | null = null;
  function refreshOnce(): Promise<string | null> {
    if (!refreshing) {
      refreshing = refreshAccessToken().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function endSession(): Promise<void> {
    try {
      await endRevokedSession();
    } catch {
      // The session is unusable either way; the caller is told to sign in.
    }
  }

  async function send<T>(method: HttpMethod, path: string, options: DeleteOptions<T>): Promise<T> {
    const auth = options.auth ?? 'required';
    if (options.signal?.aborted) throw new TransportError('cancelled');

    // For `required` routes a missing session fails fast. For `optional` ones
    // whatever we have is sent, and the route decides.
    let token: string | null;
    try {
      token = await accessToken();
    } catch (error) {
      // An expired token that could not be refreshed because the phone is
      // offline: that member is offline, not signed out, and "Please sign
      // in" would send them to a sign-in that cannot work either.
      if (auth === 'required' && error instanceof TransportError) throw error;
      token = null;
    }
    if (!token && auth === 'required') throw new NotAuthenticatedError();

    const prepared = prepare(method, path, options, token);
    const answer = await perform(prepared, options);
    if (answer.status === 401 && auth === 'required') {
      return recoverFromUnauthorized(prepared, answer, options);
    }
    return decodeAnswer(answer, options.decode);
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
    options: DeleteOptions<T>,
  ): Promise<T> {
    const refusal = errorFor(first);
    let fresh: string | null;
    try {
      fresh = await refreshOnce();
    } catch (error) {
      if (error instanceof RefreshRefusedError) {
        await endSession();
        throw new NotAuthenticatedError();
      }
      // Offline, or the auth server failing: nothing is known about the
      // session, so it is kept and this request fails as it came.
      throw refusal;
    }
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
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
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
      clearTimeout(timer);
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
  const problem = decodeProblemDetails(json, answer.status);
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
