/**
 * Who tells the member how a payment ended when the screen that started it is
 * gone: after Android closed the app behind the page (the in-flight
 * recovery), or when the screen closed while the confirm ran.
 *
 * Each rail registers its presenter (BOOK-1 for bookings and classes, with
 * the check-in reminders; CHECKIN-2 for the walk-in's proof; PLANS-2 for the
 * welcome; ACCT-2 and ACCT-3 to refresh Account). Until one has, the default
 * below shows the same alert the rail's screen would have shown, in the same
 * words (iOS `BookingCopy` and `CheckInView` pay outcomes, `PlansView`'s
 * welcome and payment issue), and a booking that landed gets the check-in
 * reminders iOS schedules when any booking lands. Card setup and co-pay are
 * quiet, as on iOS: Account re-renders from what it reads.
 *
 * A rail's own presenter replaces the default whole: BOOK-1's must schedule
 * the reminders itself.
 */
import { refusalMessage } from '../api';
import { MerchantInfo } from '../config/merchantInfo';
import { showDialog, type DialogButton } from '../components/ui/Dialog';
import { t } from '../i18n';
import { scheduleBookingReminders } from '../services/notifications';

import type { PaySettlement } from './bookingPaymentSession';
import type { ConfirmedCard } from './cardSetup';
import {
  payCopyContext,
  type BookingInflight,
  type CardSetupInflight,
  type CopayInflight,
  type InflightRail,
  type PlanInflight,
  type WalkInInflight,
} from './inflight';
import { confirmedBody, payOutcomeMessage, payOutcomeTitle, walkInConfirmRefusalMessage } from './payOutcomeCopy';
import type { PlanVerification } from './planVerification';

/** How a payment the screen could not show ended, by rail. */
export type PaymentResolution =
  | { readonly rail: 'booking'; readonly record: BookingInflight; readonly settlement: PaySettlement }
  | { readonly rail: 'walk_in'; readonly record: WalkInInflight; readonly settlement: PaySettlement }
  | { readonly rail: 'plan'; readonly record: PlanInflight; readonly verification: PlanVerification }
  | {
      readonly rail: 'card_setup';
      readonly record: CardSetupInflight;
      /** The card the pull found (null: none added); undefined when the confirm failed. */
      readonly card: ConfirmedCard | null | undefined;
    }
  | { readonly rail: 'copay'; readonly record: CopayInflight; readonly settled: boolean };

/** What a presenter can do besides showing words. */
export interface PresenterActions {
  /**
   * Check again under the same key (a booking or walk-in still `processing`):
   * asks the server again and presents what it says. A no-op for other rails.
   */
  readonly checkAgain: () => void;
}

export type PaymentOutcomePresenter = (resolution: PaymentResolution, actions: PresenterActions) => void;

const presenters = new Map<InflightRail, PaymentOutcomePresenter>();

/**
 * Replaces the default presenter for `rail` (one per rail; registering again
 * replaces it). Returns an unregister. Register from the rail's own
 * `src/features/<area>/register.ts`, so the presenter is in place before any
 * recovery runs.
 */
export function registerPaymentOutcomePresenter(rail: InflightRail, presenter: PaymentOutcomePresenter): () => void {
  presenters.set(rail, presenter);
  return () => {
    if (presenters.get(rail) === presenter) presenters.delete(rail);
  };
}

/** Shows `resolution` through the rail's presenter, or the default one. */
export function presentResolution(resolution: PaymentResolution, actions: PresenterActions): void {
  const presenter = presenters.get(resolution.rail) ?? defaultPresenter;
  try {
    presenter(resolution, actions);
  } catch (error) {
    if (__DEV__ && process.env.NODE_ENV !== 'test') console.warn('[payments] presenter failed', error);
  }
}

/** True when the default presenter has anything to say about `resolution`. */
function defaultSpeaks(resolution: PaymentResolution): boolean {
  switch (resolution.rail) {
    case 'booking':
    case 'walk_in':
      return resolution.settlement.kind !== 'sessionNotFound';
    case 'plan':
      return resolution.verification.kind !== 'cancelled' && resolution.verification.kind !== 'unverified';
    case 'card_setup':
    case 'copay':
      return false;
  }
}

/**
 * Whether `resolution` goes to a presenter at all. The default speaks only
 * when there is something to say; a rail's own presenter is also told about
 * the quiet endings (a card setup, a co-pay, a session that never existed),
 * so Account can re-read what it shows, and shows nothing for them.
 */
export function shouldPresent(resolution: PaymentResolution): boolean {
  return presenters.has(resolution.rail) || defaultSpeaks(resolution);
}

// ---------------------------------------------------------------------------
// The defaults

function ok(): DialogButton[] {
  return [{ label: t('common.ok'), role: 'cancel' }];
}

/** A pay outcome's buttons, as each iOS screen has them. */
function outcomeButtons(settlement: PaySettlement, walkIn: boolean, actions: PresenterActions): DialogButton[] {
  if (settlement.kind !== 'outcome') return ok();
  switch (settlement.outcome.kind) {
    case 'processing':
      return [
        { label: t('common.cancel'), role: 'cancel' },
        { label: t('booking.pay.check_again'), onPress: actions.checkAgain },
      ];
    case 'needsAttention':
      // The booking flow ends on Done; the door's alert has OK.
      return walkIn ? ok() : [{ label: t('common.done') }];
    default:
      return ok();
  }
}

/**
 * The check-in reminders for a booking that landed while its screen was gone.
 * iOS schedules them the moment any booking lands (`BookingConfirmComponents`
 * on `bookingComplete`, `ClassReminderService.scheduleCheckInReminder`): the
 * class's name, else the activity's, at the class's or the slot's start,
 * with the notification permission asked right there, in context. A refusal
 * or a failure never touches the booking.
 *
 * Through the legacy notification shim's `scheduleBookingReminders`, which
 * F7 turns into iOS's T-30 and T-10 reminders, until BOOK-1 registers its
 * own presenter (and with it its own reminder call).
 */
function scheduleCheckInReminders(record: BookingInflight): void {
  const { booking } = record;
  const startsAt = booking.startsAt ? new Date(booking.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return;
  const name = booking.className?.trim() || booking.activityName?.trim() || '';
  try {
    void scheduleBookingReminders({
      bookingId: record.key,
      venueName: booking.venueName?.trim() ?? '',
      activityName: name,
      bookingTime: startsAt,
    }).catch(() => undefined);
  } catch {
    // Reminders are a courtesy: nothing about them may reach the member's booking.
  }
}

function presentPaySettlement(resolution: PaymentResolution & { rail: 'booking' | 'walk_in' }, actions: PresenterActions) {
  const { settlement, record } = resolution;
  const walkIn = resolution.rail === 'walk_in';
  switch (settlement.kind) {
    case 'sessionNotFound':
      return;
    case 'failed':
      showDialog({
        title: t(walkIn ? 'common.error_title' : 'booking.err.title'),
        message: walkIn ? walkInConfirmRefusalMessage(settlement.error) : refusalMessage(settlement.error),
        buttons: ok(),
      });
      return;
    case 'fulfilled':
      if (resolution.rail === 'walk_in') {
        const venue = resolution.record.walkIn.venueName?.trim();
        showDialog({
          title: t('checkin.proof.banner_title'),
          message: venue
            ? t('payments.recovered.checked_in_venue', { venue })
            : t('payments.recovered.checked_in'),
          buttons: ok(),
        });
      } else {
        showDialog({
          title: t('booking.confirmed_title'),
          message: confirmedBody(true, resolution.record.booking.kind === 'class'),
          buttons: [{ label: t('common.done') }],
        });
        scheduleCheckInReminders(resolution.record);
      }
      return;
    case 'outcome':
      showDialog({
        title: payOutcomeTitle(settlement.outcome),
        message: payOutcomeMessage(settlement.outcome, payCopyContext(record)),
        buttons: outcomeButtons(settlement, walkIn, actions),
      });
      return;
  }
}

function presentPlan(record: PlanInflight, verification: PlanVerification) {
  switch (verification.kind) {
    case 'confirmed': {
      const name = record.plan.planName?.trim();
      const message = name
        ? t(record.plan.productSlug.startsWith('pass-') ? 'plans.success.pass' : 'plans.success.subscription', { name })
        : t('plans.success.generic');
      showDialog({ title: t('plans.welcome_title'), message, buttons: [{ label: t('plans.welcome_cta') }] });
      return;
    }
    case 'timeout':
      showDialog({
        title: t('plans.payment_issue'),
        message: t('plans.confirm_timeout', { email: MerchantInfo.email }),
        buttons: ok(),
      });
      return;
    case 'failed':
      showDialog({ title: t('plans.payment_issue'), message: refusalMessage(verification.error), buttons: ok() });
      return;
    case 'cancelled':
    case 'unverified':
      return;
  }
}

/** The default presenter: the rail's own alert, in its own words. */
export const defaultPresenter: PaymentOutcomePresenter = (resolution, actions) => {
  switch (resolution.rail) {
    case 'booking':
    case 'walk_in':
      presentPaySettlement(resolution, actions);
      return;
    case 'plan':
      presentPlan(resolution.record, resolution.verification);
      return;
    case 'card_setup':
    case 'copay':
      return;
  }
};

/** Tests only: drop every registered presenter. */
export function resetPresentersForTests(): void {
  presenters.clear();
}
