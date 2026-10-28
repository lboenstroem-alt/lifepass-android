/**
 * What the report sheet does when `POST /coach/reports` fails, decided from
 * the client's typed error (src/api/errors.ts):
 *
 *   cancelled         the sheet went away mid-call: nothing is shown
 *   signed out        `NotAuthenticatedError` ONLY: the client has ended the
 *                     session (the refresh was refused, or the resend was
 *                     refused again) and the auth listener takes the app to
 *                     sign-in (the app's session-expired handling): the
 *                     sheet just closes, with no alert of its own
 *   any other 401     the refresh after the 401 failed for a while (the
 *                     auth server unreachable, a 5xx, a 429): the client
 *                     KEEPS the session and throws the 401 as it came, so
 *                     the app stays where it is. The sheet stays up with
 *                     the app's sign-in sentence (what every screen says on
 *                     this path, and never the server's words); the key is
 *                     kept, as nothing was stored
 *   429               this account has sent 20 reports in 24 hours: its own
 *                     sentence, and the key is spent (the server answered)
 *   offline, timeout,
 *   network, 5xx      the app's usual retry words; the KEY IS KEPT, because
 *                     the report may have reached the server, and a Send
 *                     again with the same key can only replay that answer
 *   anything else     a 422 or another refusal the sheet never expects:
 *                     the refusal fallback, the key spent
 *
 * The server's own `title` and `detail` are never shown.
 */
import { errorMessage, isApiError, isCancellation, NotAuthenticatedError } from '../../../api';
import { t } from '../../../i18n';

export type ReplyReportFailure =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'signedOut' }
  /** Shown on the sheet; `keepKey` says whether a Send again reuses this attempt's Idempotency-Key. */
  | { readonly kind: 'message'; readonly message: string; readonly keepKey: boolean };

/** The status iOS reads: a problem's own, or the response's for a body that was not one. */
function statusOf(error: unknown): number {
  return isApiError(error) ? (error.status ?? 0) : 0;
}

export function replyReportFailure(error: unknown): ReplyReportFailure {
  if (isCancellation(error)) return { kind: 'cancelled' };
  const status = statusOf(error);
  if (error instanceof NotAuthenticatedError) return { kind: 'signedOut' };
  if (status === 401) return { kind: 'message', message: t('error.sign_in'), keepKey: true };
  if (status === 429) return { kind: 'message', message: t('coach.report.rate_limited'), keepKey: false };
  if (status >= 500) return { kind: 'message', message: t('error.server'), keepKey: true };
  if (isApiError(error) && (error.kind === 'transport' || error.kind === 'decoding')) {
    // Offline, a timeout, a dropped connection, or a 2xx whose envelope did
    // not read: the formatter's own words ("No internet connection...").
    return { kind: 'message', message: errorMessage(error), keepKey: true };
  }
  if (isApiError(error)) return { kind: 'message', message: t('error.refusal_fallback'), keepKey: false };
  // Not from the client at all (a bug): the generic words, and the key kept,
  // as nothing says the server answered.
  return { kind: 'message', message: errorMessage(error), keepKey: true };
}
