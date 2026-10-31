// Session hooks for the booking flow and class reminders: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); BOOK-1 fills it in. Imported once at
// startup by src/app/registrations.ts, so a hook registered here is in place
// before any sign-in or sign-out can happen.
//
// THE BOOKING'S PAYMENT OUTCOME AFTER THE SCREEN WAS GONE. A card-less
// booking is paid on a Custom Tab, and Android may close the app (or the
// screen) behind it. F8's recovery then settles the payment and hands the
// outcome to the rail's presenter (src/payments/presenters.ts). Ours shows
// what the flow would have shown, in the same words, and, when the booking
// landed, does what the flow does when it lands: schedules the check-in
// reminders (iOS `BookingOutcomeHandling` on `bookingComplete`) and refreshes
// the plan and usage (iOS `refreshCredits` after a paid booking). Every other
// ending is F8's default alert.
//
// Nothing else is kept per member: a booking session lives in its screen's
// memory only, and the in-flight payment records are F8's (wiped at sign-out
// by src/payments/register.ts). The class reminders stay across a sign-out,
// as on iOS: they hold no health data.
import { showDialog } from '../../components/ui/Dialog';
import { currentLanguage, t } from '../../i18n';
import { confirmedBody, defaultPresenter, registerPaymentOutcomePresenter, type PaymentOutcomePresenter } from '../../payments';
import { useAppStore } from '../../stores/appStore';
import { scheduleCheckInReminder } from '../bookings';

/** The booking rail's presenter (see the file comment). */
export const presentBookingOutcome: PaymentOutcomePresenter = (resolution, actions) => {
  if (resolution.rail !== 'booking' || resolution.settlement.kind !== 'fulfilled') {
    defaultPresenter(resolution, actions);
    return;
  }
  const { booking } = resolution.record;
  showDialog({
    title: t('booking.confirmed_title'),
    message: confirmedBody(true, booking.kind === 'class'),
    buttons: [{ label: t('common.done') }],
  });
  const startsAt = booking.startsAt ? new Date(booking.startsAt) : null;
  if (startsAt && !Number.isNaN(startsAt.getTime())) {
    void scheduleCheckInReminder({
      className: booking.className?.trim() || booking.activityName?.trim() || null,
      startsAt,
      language: currentLanguage(),
    }).catch(() => undefined);
  }
  void useAppStore
    .getState()
    .refreshCredits()
    .catch(() => undefined);
};

registerPaymentOutcomePresenter('booking', presentBookingOutcome);
