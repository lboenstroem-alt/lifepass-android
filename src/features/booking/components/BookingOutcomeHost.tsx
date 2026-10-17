// Everything after Confirm, as dialogs (iOS BookingOutcomeHandling): the 402
// charge consent, the old server's "add a card", the pay outcomes, the
// pending, timed-out and confirmed alerts, and the error alert with its
// refusal step. The payment page itself is F8's Custom Tab, opened by the
// session (./bookingSession.ts), so nothing here presents it.
//
// One dialog at a time, the first that applies in the order below: iOS
// queues its alerts the same way, and two Android dialogs stacked would hide
// the one that matters.
//
// `onClose` pops the full flow, or closes the class sheet (CLASS-2).
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { ctaLabelKey, REFUSAL_WEB_PROFILE_URL, type RefusalCta } from '../../../api/refusals';
import { Dialog, type DialogButton } from '../../../components/ui';
import { useT, type Lang } from '../../../i18n';
import { bookingCopy, confirmedBody, payOutcomeMessage, payOutcomeTitle } from '../bookingCopy';
import { usesClasses, type BookingSession, type BookingSessionStore } from '../bookingSession';
import { useBooking } from '../useBookingSession';

export interface BookingOutcomeHostProps {
  readonly store: BookingSessionStore;
  /** Leaves the screen: Done on a booking, a parked payment, a page that never opened. */
  readonly onClose: () => void;
  readonly offers: (cta: RefusalCta) => boolean;
  readonly onStep: (cta: RefusalCta) => void;
  /** A booking landed (confirmed, or accepted and pending): the caller may refresh. */
  readonly onBooked?: () => void;
}

interface DialogContent {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly buttons: DialogButton[];
}

/** The dialog the session's state asks for, or null (exported for tests). */
export function outcomeDialog(
  s: BookingSession,
  lang: Lang,
  t: (key: string, params?: Record<string, string | number>) => string,
  actions: {
    readonly onClose: () => void;
    readonly offers: (cta: RefusalCta) => boolean;
    readonly onStep: (cta: RefusalCta) => void;
    /** The session as it is when a button is pressed (default: `s`). */
    readonly current?: () => BookingSession;
  },
): DialogContent | null {
  const state = actions.current ?? ((): BookingSession => s);
  const copy = bookingCopy(lang);

  // 402 charge consent: the disclosed price, kind-aware, with the
  // price-changed note on a re-offer.
  if (s.showChargeConsent && s.pendingOffer) {
    return {
      id: 'consent',
      title: t('consent.title'),
      message: copy.chargeConsentMessage(s),
      buttons: [
        { label: copy.consentButtonLabel(s), onPress: () => void state().acceptCharge(), testID: 'booking.consent.accept' },
        { label: t('common.cancel'), role: 'cancel', onPress: () => state().declineCharge(), testID: 'booking.consent.cancel' },
      ],
    };
  }

  // The fallback for an OLD server only: a card-less class refused on the
  // session (nothing charged) sends the member to add a card on the web.
  if (s.needsPaymentMethod) {
    return {
      id: 'no-card',
      title: t('checkin.err.no_card_title'),
      message: t('booking.err.no_card_body'),
      buttons: [
        {
          label: t('checkin.err.no_card_cta'),
          onPress: () => {
            state().dismissNeedsPaymentMethod();
            void Linking.openURL(REFUSAL_WEB_PROFILE_URL).catch(() => undefined);
          },
        },
        { label: t('common.cancel'), role: 'cancel', onPress: () => state().dismissNeedsPaymentMethod() },
      ],
    };
  }

  // Terminal pay outcomes (a fulfilled booking is `bookingComplete`).
  if (s.payOutcome) {
    const outcome = s.payOutcome;
    const context = usesClasses(s) ? 'class' : 'slot';
    let buttons: DialogButton[];
    switch (outcome.kind) {
      case 'processing':
        buttons = [
          {
            label: t('booking.pay.check_again'),
            onPress: () => void state().confirmBookingPayment(),
            testID: 'booking.pay.check_again',
          },
          { label: t('common.cancel'), role: 'cancel', onPress: () => state().dismissPayOutcome() },
        ];
        break;
      case 'needsAttention':
        // Parked for operations: leave the flow so a stale attempt can't be
        // driven again from here.
        buttons = [
          {
            label: t('common.done'),
            onPress: () => {
              state().dismissPayOutcome();
              actions.onClose();
            },
          },
        ];
        break;
      default:
        buttons = [
          {
            label: t('common.ok'),
            role: 'cancel',
            onPress: () => {
              // A page that never opened: the next attempt starts from a
              // fresh screen (iOS can't show its cover again).
              const closes = state().payPageNeverOpened;
              state().dismissPayOutcome();
              if (closes) actions.onClose();
            },
          },
        ];
    }
    return {
      id: `pay-${outcome.kind}`,
      title: payOutcomeTitle(outcome, lang),
      message: payOutcomeMessage(outcome, context, lang),
      buttons,
    };
  }

  // Accepted but not confirmed: the capture is still resolving. No reminder.
  if (s.bookingPendingConfirmation) {
    return {
      id: 'pending',
      title: t('booking.pending_title'),
      message: t('booking.pending_body'),
      buttons: [
        {
          label: t('common.done'),
          onPress: () => {
            state().dismissBooked();
            actions.onClose();
          },
        },
      ],
    };
  }

  // The create timed out: the booking may still go through.
  if (s.bookingOutcomeUnknown) {
    return {
      id: 'timeout',
      title: t('booking.timeout_title'),
      message: t('booking.timeout_body'),
      buttons: [
        { label: t('booking.pay.check_again'), onPress: () => void state().checkBookingAgain(), testID: 'booking.timeout.check_again' },
        { label: t('common.cancel'), role: 'cancel', onPress: () => state().dismissOutcomeUnknown() },
      ],
    };
  }

  // Booked: the check-in sentence, then free check-in or "it's paid".
  if (s.bookingComplete) {
    return {
      id: 'confirmed',
      title: t('booking.confirmed_title'),
      message: confirmedBody(s.bookingWasPaid, usesClasses(s), lang),
      buttons: [
        {
          label: t('common.done'),
          onPress: () => {
            state().dismissBooked();
            actions.onClose();
          },
          testID: 'booking.confirmed.done',
        },
      ],
    };
  }

  // A refusal in the app's words, with its step when the screen can take it.
  if (s.error !== null) {
    const cta = s.errorCta && actions.offers(s.errorCta) ? s.errorCta : null;
    const buttons: DialogButton[] = [];
    if (cta) {
      buttons.push({
        label: t(ctaLabelKey(cta)),
        onPress: () => {
          state().dismissError();
          actions.onStep(cta);
        },
        testID: 'booking.error.cta',
      });
    }
    buttons.push({ label: t('common.ok'), role: 'cancel', onPress: () => state().dismissError(), testID: 'booking.error.ok' });
    return {
      id: 'error',
      title: t('booking.err.title'),
      message: s.error || t('common.error_body'),
      buttons,
    };
  }

  return null;
}

export default function BookingOutcomeHost({ store, onClose, offers, onStep, onBooked }: BookingOutcomeHostProps) {
  const { t, language } = useT();
  const session = useBooking(store, (s) => s);
  const dialog = outcomeDialog(session, language, t, { onClose, offers, onStep, current: store.getState });

  // The caller refreshes when a booking lands, confirmed or pending.
  const booked = session.bookingComplete || session.bookingPendingConfirmation;
  const wasBooked = useRef(booked);
  const latestOnBooked = useRef(onBooked);
  latestOnBooked.current = onBooked;
  useEffect(() => {
    if (booked && !wasBooked.current) latestOnBooked.current?.();
    wasBooked.current = booked;
  }, [booked]);

  return (
    <Dialog
      visible={dialog !== null}
      // Every close goes through one of the buttons, which say what it means.
      onClose={() => undefined}
      title={dialog?.title ?? ''}
      message={dialog?.message}
      buttons={dialog?.buttons ?? []}
      testID={dialog ? `booking.dialog.${dialog.id}` : 'booking.dialog'}
    />
  );
}
