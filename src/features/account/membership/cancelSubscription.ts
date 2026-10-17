/**
 * Cancelling the member's plan, `POST /subscriptions/cancel`: the Android port
 * of iOS `SubscriptionService.cancel` and `AccountView.cancelSubscription`'s
 * confirmation copy.
 *
 * The server always answers 200 and says WHICH cancellation happened
 * (`status`, a discriminated union):
 * - `cancellation_request_received`: a monthly plan still inside its
 *   committed term. It stays active AND BILLED until `endsAt`, then ends.
 * - `cancellation_scheduled`: a rolling monthly plan past its term, or an
 *   annual one. It does not renew; access continues until
 *   `currentPeriodEndsAt`.
 * The member is told which of the two it was, because "you keep access" and
 * "you keep paying" are different promises. There is no un-cancel.
 */
import { apiPost } from '../../../api/client';
import { parseIsoDate, wireId } from '../../../api/wire';
import { formatDateTemplate } from '../../../i18n/format';
import { translate, type Lang } from '../../../i18n';

/** The committed-term branch: billed until `endsAt`. */
export const CANCELLATION_REQUEST_RECEIVED = 'cancellation_request_received';

/** iOS `SubscriptionCancelResult`. */
export interface SubscriptionCancelResult {
  /** `cancellation_request_received` | `cancellation_scheduled`. Kept as a string, as iOS does. */
  readonly status: string;
  /** The committed-term branch's end. */
  readonly endsAt: Date | null;
  /** The scheduled branch's end. */
  readonly currentPeriodEndsAt: Date | null;
}

/** A shape the decoder refuses; the API client turns it into `DecodingError`. */
export class CancelResultShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected cancel result shape at ${path}`);
    this.name = 'CancelResultShapeError';
  }
}

/** Swift `Date?`: absent or null is null; a value that is not an ISO-8601 instant fails. */
function optionalDate(value: unknown, path: string): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? parseIsoDate(value) : null;
  if (!parsed) throw new CancelResultShapeError(path);
  return parsed;
}

export function decodeCancelResult(data: unknown): SubscriptionCancelResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new CancelResultShapeError('result');
  const raw = data as Record<string, unknown>;
  if (typeof raw.status !== 'string') throw new CancelResultShapeError('status');
  return {
    status: raw.status,
    endsAt: optionalDate(raw.endsAt, 'endsAt'),
    currentPeriodEndsAt: optionalDate(raw.currentPeriodEndsAt, 'currentPeriodEndsAt'),
  };
}

/**
 * Schedules the cancellation. The id goes out lower case (the 2.3.0 lesson:
 * a server comparing ids as strings refuses its own ids in another case), and
 * the caller passes a fresh key per confirmed tap.
 */
export function cancelSubscription(subscriptionId: string, idempotencyKey: string): Promise<SubscriptionCancelResult> {
  return apiPost<SubscriptionCancelResult>(
    '/subscriptions/cancel',
    { subscriptionId: wireId(subscriptionId) },
    { idempotencyKey, decode: decodeCancelResult },
  );
}

/**
 * The day the plan ends, in the order iOS reads it: the committed term's
 * `endsAt`, else the scheduled `currentPeriodEndsAt`, else the period end the
 * phone already knew.
 */
export function cancellationEndDate(result: SubscriptionCancelResult, knownPeriodEnd: Date): Date {
  return result.endsAt ?? result.currentPeriodEndsAt ?? knownPeriodEnd;
}

/**
 * The confirmation's body: the committed-term copy for
 * `cancellation_request_received`, the "won't renew" copy for anything else.
 *
 * iOS writes the date with `.formatted(date: .abbreviated)`, which follows
 * the phone's region. Android writes it in the account language on
 * Reykjavík's calendar ("1 Oct 2026" / "1. okt. 2026"), the same way the
 * member card's renewal line is written, so the two never disagree.
 */
export function cancelConfirmationBody(result: SubscriptionCancelResult, knownPeriodEnd: Date, lang: Lang): string {
  const date = formatDateTemplate(cancellationEndDate(result, knownPeriodEnd), 'dMMMy', lang);
  return result.status === CANCELLATION_REQUEST_RECEIVED
    ? translate('account.cancel_committed_body', lang, { date })
    : translate('account.cancel_scheduled_body', lang, { date });
}
