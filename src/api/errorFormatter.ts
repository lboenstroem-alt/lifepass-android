/* eslint lifepass/no-literal-copy: "error" */
/**
 * Any error, as a sentence a member can read, in the language on screen: the
 * Android port of iOS `ErrorFormatter` (Services/ErrorFormatter.swift) and of
 * `MemberRefusal.resolve(_ error:)`.
 *
 * Two entry points:
 *
 *   errorMessage(error)            every screen that is not refusing anything
 *   refusalMessage(error, context) the screens that refuse a member: both
 *                                  booking sheets, the pay rail, the scanner,
 *                                  My bookings' cancel, the purchase gates
 *
 * `refusalMessage` never shows the server's `title`, `detail` or code: a
 * problem reads as its `MemberRefusal` row or the plain sentence for its
 * status, and the server's words go to the (development) log only.
 *
 * We never leak raw server error bodies to the UI: SDK errors (PostgREST,
 * Edge Functions) carry implementation details (table names, SQL hints), so
 * they read as the generic sentence.
 */
import {
  FunctionsError,
  isAuthError,
  isAuthRetryableFetchError,
  PostgrestError,
} from '@supabase/supabase-js';

import { t } from '../i18n';

import { knownDisconnected } from './connectivity';
import { ApiError, HttpStatusError, LocalizedError, ProblemError } from './errors';
import { resolveRefusal, type MemberRefusal, type RefusalContext } from './refusals';

/**
 * Produce a member-facing message from any error. The app's own errors (every
 * `ApiError`, a `LocalizedError`) are authored to be safe to show; SDK errors
 * are mapped to short sentences; anything else reads as the generic sentence,
 * because a JavaScript error's message is a developer's words.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof LocalizedError) {
    const text = error.message;
    if (text) return text;
  }

  // A raw fetch failure outside the API client (an image, a third-party read).
  const transport = rawTransportKey(error);
  if (transport) return t(transport);

  // Edge Functions: the raw body stays out of a release build. A development
  // build shows what the function said, so a developer can triage it without
  // tailing the Supabase logs. (Android calls no Edge Function today.)
  if (error instanceof FunctionsError) {
    return __DEV__ ? `Debug: ${error.message}` : t('error.generic');
  }

  // PostgREST: may include SQL detail; hidden.
  if (error instanceof PostgrestError) return t('error.generic');

  // Supabase Auth. Its own refusals carry user-safe sentences (as on iOS);
  // the auth server being unreachable is a connection failure, not a
  // sentence. On iOS that is a URLError, read as "offline" on a phone with
  // no network: NetInfo's last word says which here.
  if (isAuthError(error)) {
    if (isAuthRetryableFetchError(error)) {
      if (error.status && error.status >= 500) return t('error.server');
      return t(connectionFailureKey());
    }
    if (error.message) return error.message;
  }

  return t('error.generic');
}

/**
 * The variant iOS keeps for trusted Edge Functions whose `{ error }` body is
 * curated member copy. Android calls no Edge Function, and supabase-js only
 * exposes such a body asynchronously, so this is `errorMessage` here; it
 * exists so ported call sites keep their shape.
 */
export function serverFacingMessage(error: unknown): string {
  return errorMessage(error);
}

/**
 * The refusal row for a thrown error: a problem by its code, reason and
 * status. Anything that is not a problem (offline, a timeout, a body that did
 * not decode, a gateway page) has no row and is null, so a screen's own
 * handling decides its step.
 */
export function refusalFor(error: unknown, context: RefusalContext = 'general'): MemberRefusal | null {
  if (!(error instanceof ProblemError)) return null;
  return resolveRefusal(error.slug, error.details.reason ?? null, error.details.status ?? 0, context);
}

/**
 * For the screens that refuse a member: a problem reads as its
 * `MemberRefusal` row, or the plain sentence for its status, and never as the
 * server's `title`, `detail` or code, whatever the slug.
 *
 * A status with no problem body (a platform's 502 or 504 page in front of a
 * long create, a crash page) reads as our failure for a 5xx and as the
 * fallback for anything else, never as "HTTP 504". Anything that is not a
 * problem (offline, a timeout) reads as `errorMessage`.
 */
export function refusalMessage(error: unknown, context: RefusalContext = 'general'): string {
  const refusal = refusalFor(error, context);
  if (refusal && error instanceof ProblemError) {
    logRefusal(error, refusal);
    return t(refusal.messageKey);
  }
  if (error instanceof HttpStatusError) {
    refusalLog(`refusal unexpected status ${error.httpStatus}`);
    return t(error.httpStatus >= 500 ? 'error.server' : 'error.refusal_fallback');
  }
  return serverFacingMessage(error);
}

// ---------------------------------------------------------------------------
// The refusal log

type RefusalLogger = (line: string) => void;

const developmentLogger: RefusalLogger = (line) => {
  console.info(line);
};

let refusalLogger: RefusalLogger | null =
  __DEV__ && process.env.NODE_ENV !== 'test' ? developmentLogger : null;

/**
 * Where refusals are logged: the code, status and reason, and what the member
 * was shown. The server's `detail` is included only here, never on screen. A
 * release build logs nothing (logcat is readable by more than the member);
 * `null` turns the log off, a function sends it elsewhere (tests).
 */
export function setRefusalLogger(logger: RefusalLogger | null): void {
  refusalLogger = logger;
}

function refusalLog(line: string): void {
  refusalLogger?.(line);
}

function logRefusal(error: ProblemError, refusal: MemberRefusal): void {
  if (!refusalLogger) return;
  const p = error.details;
  refusalLog(
    `refusal ${error.slug} ${p.status ?? 0} reason=${p.reason ?? '-'} shown=${refusal.messageKey} ` +
      `requestId=${error.requestId ?? '-'} detail=${p.detail ?? '-'}`,
  );
}

// ---------------------------------------------------------------------------

/**
 * A connection that failed with no answer: "offline" when NetInfo last said
 * the phone has no network (iOS `notConnectedToInternet`), else "network
 * error". The last known state, because this cannot wait for NetInfo.
 */
function connectionFailureKey(): string {
  return knownDisconnected() ? 'error.offline' : 'error.network';
}

/**
 * React Native's fetch rejects with a TypeError ("Network request failed",
 * "Network request timed out") and an aborted one with an AbortError: the
 * raw URLError branch of iOS ErrorFormatter, the only place a cancellation
 * has words of its own.
 */
function rawTransportKey(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.name === 'AbortError') return 'error.cancelled';
  if (error instanceof TypeError) {
    if (/timed out/i.test(error.message)) return 'error.timeout';
    if (/network request failed|failed to fetch|fetch failed|network error/i.test(error.message)) {
      return connectionFailureKey();
    }
  }
  return null;
}

/** The formatter under the iOS names, for code ported from Swift. */
export const ErrorFormatter = {
  message: errorMessage,
  serverFacingMessage,
  refusalMessage,
} as const;
