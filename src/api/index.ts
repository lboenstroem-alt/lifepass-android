/**
 * The API layer's public surface: the client, the error model, the refusal
 * table and the formatter. Feature code imports from here.
 *
 *   import { apiGet, isProblem, refusalMessage } from '../../api';
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
