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
  type ApiClient,
  type ApiClientDeps,
  type AuthMode,
  type DeleteOptions,
  type HttpMethod,
  type Query,
  type QueryValue,
  type RequestOptions,
} from './client';
export * from './errors';
export * from './errorFormatter';
export * from './idempotency';
export * from './refusals';
export * from './wire';
