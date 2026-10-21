/* eslint lifepass/no-literal-copy: "error" */
/**
 * A walk-in refused, in the member's words, with its next step: the Android
 * port of `CheckInViewModel.blockingRefusal`, `confirmRefusal` and
 * `walkInBlockingReasons` (iOS 2.5.5), over the shared refusal table
 * (src/api/refusals.ts) in its check-in context.
 *
 * The server's `title` and `detail` never reach the member. A blocked
 * preview's `blockingReason` reads as its own row; a confirm, preview or pay
 * step refused with a problem reads as its row (or the plain sentence for
 * its status); anything that is not a problem (offline, a timeout, a
 * gateway's 504 page) keeps the formatter's words with NO step, because the
 * check-in may still have gone through.
 */
import { MemberRefusal, ProblemError, type RefusalCta } from '../../../api';
import { walkInConfirmRefusalMessage } from '../../../payments';
import { t } from '../../../i18n';

/** A refusal as the Scan tab shows it: the alert's message, and its second button. */
export interface WalkInRefusal {
  readonly message: string;
  readonly cta: RefusalCta | null;
}

/**
 * Every `WalkInBlockingReason` the preview sends (`checkins.ts` at 98fe5d2d),
 * for the tests that hold each to its own copy.
 */
export const WALK_IN_BLOCKING_REASONS: readonly string[] = [
  'walk_ins_not_allowed',
  'walk_in_no_activity',
  'daily_use_cap_reached',
  'no_active_plan_or_pass',
  'boutique_requires_membership',
  'monthly_cap_reached',
  'trial_venue_not_included',
  'trial_visits_spent',
];

/**
 * A preview `blockingReason` with its step. Out of monthly check-ins at a
 * venue with no drop-in price is a clean dead end here (the priced case never
 * blocks; it is the drop-in consent instead). A reason this build does not
 * know keeps 2.5.4's neutral sentence, with no step.
 */
export function blockingRefusal(reason: string | null | undefined): WalkInRefusal {
  if (!reason || !MemberRefusal.isKnown(reason)) return { message: t('checkin.err.unavailable'), cta: null };
  const refusal = MemberRefusal.resolve(reason, null, 403, 'checkIn');
  return { message: t(refusal.messageKey), cta: refusal.cta };
}

/** The steps this file names itself (step ids, not copy). */
const SEE_PLANS: RefusalCta = 'seePlans';
const TRY_AGAIN: RefusalCta = 'tryAgain';

const DROP_IN_PRICE_CODES: ReadonlySet<string> = new Set([
  'topup_price_unset',
  'topup_price_invalid',
  'topup_price_below_payout',
]);

/**
 * A failed preview, confirm or pay step. `chargeReason` is the preview's
 * top-up flavour, which tells the drop-in-price dead ends apart: a member at
 * a boutique their plan does not include never used anything up, so they
 * read the membership sentence; anyone else is out of check-ins.
 */
export function confirmRefusal(error: unknown, chargeReason?: string | null): WalkInRefusal {
  const message = walkInConfirmRefusalMessage(error, chargeReason);
  if (!(error instanceof ProblemError)) return { message, cta: null };
  if (DROP_IN_PRICE_CODES.has(MemberRefusal.normalise(error.code))) return { message, cta: SEE_PLANS };
  const status = error.details.status ?? 0;
  if (status === 429 && !MemberRefusal.isKnown(error.code)) return { message, cta: TRY_AGAIN };
  const refusal = MemberRefusal.resolve(error.slug, error.details.reason ?? null, status, 'checkIn');
  return { message, cta: refusal.cta };
}
