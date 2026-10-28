/**
 * The API layer's public surface: the client, the error model, the refusal
 * table and the formatter. Feature code imports from here.
 *
 *   import { apiGet, isProblem, refusalMessage } from '../../api';
 *
 * Behaviour for callers (what the client already does, so a screen does not
 * add handling for something that cannot happen):
 *
 *   - Check `isCancellation(e)` before showing anything. A call the caller
 *     aborted (or a screen that closed) is never an alert or the offline
 *     banner. Its `message` is the network sentence (`error.network`), as
 *     iOS words a cancelled URLError; there is no "cancelled" copy to show.
 *   - `e.status` on a `ProblemError` is the problem body's own `status`, as
 *     iOS `statusCode` reads `p.status`; a body without one has none, and the
 *     words and the refusal row read it as 0. `e.httpStatus` is the
 *     response's status, for logs only. Pass `e.details.status ?? 0` where
 *     iOS passes `p.status ?? 0`.
 *   - The client already fails at once offline. A phone with no connection
 *     (NetInfo, confirmed by a fresh read) fails a required route with
 *     `TransportError('offline')` before the auth SDK is asked (or
 *     `NotAuthenticatedError` when no session is on the phone at all, as on
 *     iOS), and a call that starts while a token refresh is failing fails at
 *     once (offline or network); once the phone is back online, a refresh
 *     that failed only for want of a network no longer stops a call. Every
 *     step has the call's ceiling. Do not wrap calls in an
 *     offline check or a timer of your own; pass `timeoutMs` from
 *     `API_TIMEOUTS` where iOS sets one.
 *   - A revoked session is always cleared on the phone. A refused refresh,
 *     or a second 401 with a fresh token, removes the session locally
 *     (SIGNED_OUT) whatever the auth server answers to the logout, and the
 *     call throws `NotAuthenticatedError`; the auth listener (F3) takes the
 *     app to sign-in. Do not sign the member out yourself. An auth server
 *     that is down or out of reach never ends a session.
 */
export {
  API_TIMEOUTS,
  apiClient,
  apiDelete,
  apiGet,
  apiGetRawData,
  apiPatch,
  apiPost,
  apiPut,
  buildUrl,
  createApiClient,
  DEFAULT_TIMEOUT_MS,
  parseRetryAfter,
  REFUSED_REFRESH_CODES,
  RefreshRefusedError,
  refreshRefused,
  setSharedApiClient,
  supabaseAccessToken,
  supabaseEndRevokedSession,
  supabaseHasStoredSession,
  supabaseRefreshAccessToken,
  supabaseSessionDeps,
  LOGOUT_WAIT_MS,
  type ApiClient,
  type ApiClientDeps,
  type AuthMode,
  type DeleteOptions,
  type HttpMethod,
  type Query,
  type QueryValue,
  type RequestOptions,
} from './client';
export {
  AUTH_REQUEST_TIMEOUT_MS,
  createAuthFetch,
  knownRefreshTrouble,
  onRefreshTrouble,
  REFRESH_RETRY_GAP_MS,
  resetRefreshTrouble,
  type AuthFetchOptions,
  type RefreshTrouble,
} from './authFetch';
export { deviceDisconnected, deviceOffline, knownDisconnected } from './connectivity';
export * from './errors';
export * from './errorFormatter';
export * from './idempotency';
export * from './refusals';
export * from './wire';
export type * from './contract';
