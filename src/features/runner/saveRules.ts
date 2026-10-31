/**
 * What an answer to the runner's Save means: the Android port of iOS
 * `RunnerCallFailure`, `RunnerSaveOutcome` and `RunnerSaveRules`
 * (Views/Workout/FinishWorkoutSheet.swift).
 *
 * THE RULES ARE PURE FUNCTIONS. The finish sheet (RUN-3) and the outbox
 * (./outbox) only carry out the decision; this table is what the tests hold
 * line by line. A refusal is read by its problem SLUG (the `type` URL's last
 * segment, hyphens folded to underscores), its status and its `reason`;
 * the server's `detail` is never read.
 */
import {
  ApiError,
  foldCode,
  HttpStatusError,
  NotAuthenticatedError,
  ProblemError,
  TransportError,
} from '../../api';

/** A failed call, reduced to what the rules branch on. */
export type RunnerFailureKind =
  /** No answer: no network, a timeout, the connection dropped. The outbox keeps it. */
  | { readonly kind: 'offline' }
  /** The caller walked away. Nothing to say. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'notAuthenticated' }
  | { readonly kind: 'problem'; readonly slug: string; readonly status: number | null; readonly reason: string | null }
  /** An answer that did not decode, or something that is not an API error at all. */
  | { readonly kind: 'other' };

export interface RunnerCallFailure {
  readonly kind: RunnerFailureKind;
  /** The API error itself, for the health store's problem table (`handle`); null when it was not one. */
  readonly apiError: ApiError | null;
}

/** `cancelled` for an abort that never went through the API client. */
function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Reads a thrown value as the rules see it (iOS `RunnerCallFailure.init`):
 * a transport failure is offline unless it was a cancellation; a problem is
 * its folded slug, its body's status and its reason; a non-problem status is
 * `http_<code>`; a decoding failure or anything else is `other`.
 */
export function readRunnerFailure(error: unknown): RunnerCallFailure {
  if (!(error instanceof ApiError)) {
    return { kind: isAbort(error) ? { kind: 'cancelled' } : { kind: 'other' }, apiError: null };
  }
  if (error instanceof TransportError) {
    return { kind: error.isCancellation ? { kind: 'cancelled' } : { kind: 'offline' }, apiError: error };
  }
  if (error instanceof NotAuthenticatedError) return { kind: { kind: 'notAuthenticated' }, apiError: error };
  if (error instanceof ProblemError) {
    return {
      kind: { kind: 'problem', slug: error.normalisedCode, status: error.status ?? null, reason: error.reason ?? null },
      apiError: error,
    };
  }
  if (error instanceof HttpStatusError) {
    return {
      kind: { kind: 'problem', slug: `http_${error.httpStatus}`, status: error.httpStatus, reason: null },
      apiError: error,
    };
  }
  return { kind: { kind: 'other' }, apiError: error };
}

/** What the runner does with an answer to Save. */
export type RunnerSaveOutcome =
  /** 200 or a replay: delete `runner.json`, close. */
  | { readonly kind: 'saved' }
  /** A transport error: queue it, delete `runner.json`, close, toast. */
  | { readonly kind: 'queueOffline' }
  /** Moved or changed on another device: "Save what you did as an extra workout?" */
  | { readonly kind: 'askSaveAsExtra' }
  /** The plan was paused or ended elsewhere: keep the file and the screen. */
  | { readonly kind: 'notActive' }
  /** 422 `idempotency_key_reused` on a member's tap: a new key, once. */
  | { readonly kind: 'retryWithNewKey' }
  /** 403, or a verified minor: the gate. The file is KEPT, so a fixed membership can still save it from Resume. */
  | { readonly kind: 'gate' }
  /** 409 consent: the consent sheet when entitled and on screen, else the reconcile (the health store decides). */
  | { readonly kind: 'consent' }
  /** Keep the file and the screen, and say this. */
  | { readonly kind: 'keep'; readonly messageKey: string }
  /** Cancelled, or signed out: nothing to say. */
  | { readonly kind: 'silent' };

/** The refusals that mean "this row moved or changed on another device". */
export const MOVED_REASONS: readonly string[] = ['not_planned', 'future_date', 'too_old'];

const NOT_SAVED: RunnerSaveOutcome = { kind: 'keep', messageKey: 'runner.err.not_saved' };

/** The Save table (iOS `RunnerSaveRules.outcome`). */
export function runnerSaveOutcome(
  failure: RunnerFailureKind,
  options: { readonly isExtra: boolean; readonly retriedKey: boolean },
): RunnerSaveOutcome {
  switch (failure.kind) {
    case 'cancelled':
    case 'notAuthenticated':
      return { kind: 'silent' };
    case 'offline':
      return { kind: 'queueOffline' };
    case 'other':
      return NOT_SAVED;
    case 'problem': {
      const slug = foldCode(failure.slug);
      switch (slug) {
        case 'health_session_not_found':
          // An extra is filed on the DATE's row, so a missing row there is
          // not "moved": asking again would loop.
          return options.isExtra ? NOT_SAVED : { kind: 'askSaveAsExtra' };
        case 'session_action_not_allowed':
          if (failure.reason === 'program_not_active') return { kind: 'notActive' };
          if (failure.reason !== null && MOVED_REASONS.includes(failure.reason)) {
            return options.isExtra ? NOT_SAVED : { kind: 'askSaveAsExtra' };
          }
          // `no_session_on_date` and anything new: keep it.
          return NOT_SAVED;
        case 'no_active_plan_or_pass':
        case 'health_minor_blocked':
          return { kind: 'gate' };
        case 'health_consent_required':
          return { kind: 'consent' };
        case 'account_pending_deletion':
          return { kind: 'keep', messageKey: 'health.err.pending_deletion' };
        case 'idempotency_key_reused':
          return options.retriedKey ? { kind: 'keep', messageKey: 'common.error_body' } : { kind: 'retryWithNewKey' };
        case 'rate_limited':
          return { kind: 'keep', messageKey: 'health.err.rate_limited' };
        default:
          if (failure.status === 404) return options.isExtra ? NOT_SAVED : { kind: 'askSaveAsExtra' };
          return NOT_SAVED;
      }
    }
  }
}

/** iOS `RunnerSaveRules`, under its own name so a port of the Swift reads like the Swift. */
export const RunnerSaveRules = {
  movedReasons: MOVED_REASONS,
  outcome: runnerSaveOutcome,
} as const;
