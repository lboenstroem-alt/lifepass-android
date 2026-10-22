/**
 * What a failed Save of the Log a workout sheet means (iOS
 * `LogWorkoutSheet.save`'s catch).
 *
 *   - a 400 `invalid_session_action` naming `asExtra`: five extras already
 *     fill the day, so the sheet stays open with "5 a day is the limit.
 *     Remove one to add another."
 *   - no answer (offline, a timeout): "This needs a connection.", the sheet
 *     stays open and the SAME key waits for the retry
 *   - the health store's one problem table says the card is stale (changed
 *     elsewhere, or the membership gate): the sheet closes and Plan reads
 *     the day again
 *   - anything else: "Something went wrong. Please try again."
 */
import { ApiError } from '../../../api';
import { useHealthStore } from '../../../health';

export type LogWorkoutFailure = 'cancelled' | 'limit' | 'offline' | 'changed' | 'other';

/** The `field` of every entry in a problem's `errors` (iOS `problemFieldNames`). */
export function problemFieldNames(error: ApiError): string[] {
  return (error.problem?.errors ?? []).flatMap((entry) => (entry.field ? [entry.field] : []));
}

/**
 * Sorts a failed Save. A refusal that is neither the limit nor offline goes
 * through the health store's problem table first (in the foreground: it may
 * present the consent sheet, or set the "changed" toast), as every health
 * write does.
 */
export function logWorkoutFailure(error: unknown): LogWorkoutFailure {
  if (!(error instanceof ApiError)) return 'other';
  if (error.isCancellation) return 'cancelled';
  if (error.isProblem('invalid_session_action') && problemFieldNames(error).includes('asExtra')) return 'limit';
  if (error.isOffline) return 'offline';
  const outcome = useHealthStore.getState().handle(error, { foreground: true });
  return outcome === 'changedElsewhere' || outcome === 'gate' ? 'changed' : 'other';
}

/** The line under Save for a failure that keeps the sheet open, or null for one that does not. */
export function logWorkoutErrorKey(failure: LogWorkoutFailure): string | null {
  switch (failure) {
    case 'limit':
      return 'logworkout.limit';
    case 'offline':
      return 'health.offline.action_hint';
    case 'other':
      return 'common.error_body';
    case 'cancelled':
    case 'changed':
      return null;
  }
}
