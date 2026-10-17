/**
 * Account deletion, the three operations (OP-04, OP-05, OP-07): the Android
 * port of iOS `AccountDeletionService` and its models
 * (Views/Profile/AccountDeletionSheet.swift).
 *
 *   const state = await fetchAccountDeletionState();
 *   const result = await requestAccountDeletion(key);   // one key per sheet
 *   const back = await cancelAccountDeletion(newIdempotencyKey());
 *
 * NO CACHE. `POST /account/deletion` answers with `healthDeleted`, the counts
 * of the member's deleted health rows, so these calls ride the health
 * client's rules on iOS (`HealthNetwork.client`: no URL cache, the health
 * session's 30 s). Here every member call already goes out `no-store`
 * (./client.ts), and the ceiling is the same 30 s.
 *
 * NO BODY ON THE REQUEST. iOS sends `{ appleAuthorizationCode }` only for an
 * account with an Apple identity, from Apple's own re-authorisation sheet on
 * that phone; without a code it sends no body at all, "exactly what 2.5.3
 * sent". Android has no Apple re-authorisation (Apple sign-in here is the
 * Supabase web flow, plan 5.3), so it always sends what iOS sends for every
 * other account: nothing. The server reads no body as "erase once nothing is
 * left to settle", the behaviour the sheet's copy describes.
 *
 * DECODED AS iOS DECODES IT. Every member-facing field is optional, so an
 * older build never fails on a state it half understands; a field that is
 * present with the wrong type still fails the read, as Swift's synthesized
 * `Decodable` does. An obligation kind stays a string: a kind this build
 * does not know draws no line (../features/account/deletion/obligations.ts)
 * rather than failing the decode.
 */
import { API_TIMEOUTS, apiGet, apiPost } from './client';
import { parseIsoDate } from './wire';

/** `active`, `deletion_pending` or `anonymised`; kept as the server's string. */
export type AccountStatus = string;

/** The status that means a deletion has been requested and erasure waits. */
export const DELETION_PENDING_STATUS = 'deletion_pending';

/** An open obligation deferring erasure (`AccountDeletionObligation`). */
export interface AccountDeletionObligation {
  /**
   * `subscription`, `future_booking`, `pending_charge`, `pending_order` or
   * `checkout_session`. A string, never an enum: an unknown one draws no line.
   */
  readonly kind: string | null;
  readonly count: number | null;
  /** When it lifts on its own; null for one that lifts only on settlement. */
  readonly clearsAt: Date | null;
}

/** `GET /account/deletion` and the cancel's answer (`AccountDeletionState`). */
export interface AccountDeletionState {
  readonly accountStatus: AccountStatus | null;
  readonly deletionRequestedAt: Date | null;
  readonly erasureScheduledAt: Date | null;
  readonly obligations: readonly AccountDeletionObligation[] | null;
}

/** `POST /account/deletion`'s answer: the state, plus what the request did. */
export interface AccountDeletionRequestResult extends AccountDeletionState {
  /** The account was already pending; nothing changed on the server. */
  readonly alreadyPending: boolean | null;
  /**
   * The health rows the same transaction deleted, by table; null when no
   * health consent stood. Never rendered: the member asked to delete the
   * account, not to audit it.
   */
  readonly healthDeleted: Readonly<Record<string, number>> | null;
}

/** The ceiling iOS gives these calls (the health session's `timeoutIntervalForRequest`). */
export const ACCOUNT_DELETION_TIMEOUT_MS = API_TIMEOUTS.healthSession;

// ---------------------------------------------------------------------------
// Decoding

/** A value the decoder refuses; the API client turns it into a `DecodingError`. */
export class AccountDeletionShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected account deletion shape at ${path}`);
    this.name = 'AccountDeletionShapeError';
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): Json {
  if (!isObject(value)) throw new AccountDeletionShapeError(path);
  return value;
}

/** `decodeIfPresent`: absent or null is null; present must read. */
function optional<T>(json: Json, key: string, path: string, read: (value: unknown, path: string) => T): T | null {
  const value = json[key];
  if (value === undefined || value === null) return null;
  return read(value, `${path}.${key}`);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new AccountDeletionShapeError(path);
  return value;
}

/** Swift `Int`: a whole number (2.0 reads as 2, 2.5 does not). */
function readInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new AccountDeletionShapeError(path);
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AccountDeletionShapeError(path);
  return value;
}

function readDate(value: unknown, path: string): Date {
  const date = parseIsoDate(readString(value, path));
  if (!date) throw new AccountDeletionShapeError(path);
  return date;
}

function readObligation(value: unknown, path: string): AccountDeletionObligation {
  const json = objectAt(value, path);
  return {
    kind: optional(json, 'kind', path, readString),
    count: optional(json, 'count', path, readInteger),
    clearsAt: optional(json, 'clearsAt', path, readDate),
  };
}

function readObligations(value: unknown, path: string): AccountDeletionObligation[] {
  if (!Array.isArray(value)) throw new AccountDeletionShapeError(path);
  return value.map((item, index) => readObligation(item, `${path}[${index}]`));
}

function readCounts(value: unknown, path: string): Record<string, number> {
  const json = objectAt(value, path);
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(json)) out[key] = readInteger(count, `${path}.${key}`);
  return out;
}

function stateFrom(json: Json, path: string): AccountDeletionState {
  return {
    accountStatus: optional(json, 'accountStatus', path, readString),
    deletionRequestedAt: optional(json, 'deletionRequestedAt', path, readDate),
    erasureScheduledAt: optional(json, 'erasureScheduledAt', path, readDate),
    obligations: optional(json, 'obligations', path, readObligations),
  };
}

/** `AccountDeletionState` from the envelope's `data`. */
export function decodeAccountDeletionState(data: unknown): AccountDeletionState {
  return stateFrom(objectAt(data, 'deletion'), 'deletion');
}

/** `AccountDeletionRequestResult` from the envelope's `data`. */
export function decodeAccountDeletionRequestResult(data: unknown): AccountDeletionRequestResult {
  const json = objectAt(data, 'deletion');
  return {
    ...stateFrom(json, 'deletion'),
    alreadyPending: optional(json, 'alreadyPending', 'deletion', readBoolean),
    healthDeleted: optional(json, 'healthDeleted', 'deletion', readCounts),
  };
}

/** The state part of a request's answer (iOS `AccountDeletionRequestResult.state`). */
export function stateOfRequestResult(result: AccountDeletionRequestResult): AccountDeletionState {
  return {
    accountStatus: result.accountStatus,
    deletionRequestedAt: result.deletionRequestedAt,
    erasureScheduledAt: result.erasureScheduledAt,
    obligations: result.obligations,
  };
}

/** The account is waiting to be erased (the sheet's pending state). */
export function isDeletionPending(state: AccountDeletionState | null | undefined): boolean {
  return state?.accountStatus === DELETION_PENDING_STATUS;
}

// ---------------------------------------------------------------------------
// Calls

export interface AccountDeletionCallOptions {
  /** The sheet closed: the read is dropped, silently (`isCancellation`). */
  readonly signal?: AbortSignal;
}

/** OP-04 `GET /account/deletion`: the state the sheet opens on. */
export function fetchAccountDeletionState(options: AccountDeletionCallOptions = {}): Promise<AccountDeletionState> {
  return apiGet<AccountDeletionState>('/account/deletion', undefined, {
    timeoutMs: ACCOUNT_DELETION_TIMEOUT_MS,
    signal: options.signal,
    decode: decodeAccountDeletionState,
  });
}

/**
 * OP-05 `POST /account/deletion`, with no body (see the file comment).
 * `idempotencyKey`: the sheet's one key, reused for a retry, so a member who
 * taps Delete twice, or retries after a timeout, makes one request.
 */
export function requestAccountDeletion(
  idempotencyKey: string,
  options: AccountDeletionCallOptions = {},
): Promise<AccountDeletionRequestResult> {
  return apiPost<AccountDeletionRequestResult>('/account/deletion', undefined, {
    idempotencyKey,
    timeoutMs: ACCOUNT_DELETION_TIMEOUT_MS,
    signal: options.signal,
    decode: decodeAccountDeletionRequestResult,
  });
}

/** OP-07 `POST /account/deletion/cancel`: "Keep my account". A fresh key per tap, as iOS mints one. */
export function cancelAccountDeletion(
  idempotencyKey: string,
  options: AccountDeletionCallOptions = {},
): Promise<AccountDeletionState> {
  return apiPost<AccountDeletionState>('/account/deletion/cancel', undefined, {
    idempotencyKey,
    timeoutMs: ACCOUNT_DELETION_TIMEOUT_MS,
    signal: options.signal,
    decode: decodeAccountDeletionState,
  });
}
