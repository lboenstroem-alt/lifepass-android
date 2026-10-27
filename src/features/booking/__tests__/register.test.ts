/**
 * The booking rail's payment-outcome presenter (../register.ts): a card-less
 * booking paid after its screen was gone (F8's recovery, or Android closing
 * the app behind the Custom Tab) is told, reminded and refreshed exactly as
 * the flow would have done it (iOS BookingOutcomeHandling on
 * `bookingComplete`). Every other ending is F8's default alert.
 */
import { showDialog } from '../../../components/ui/Dialog';
import { lookup, setCurrentLanguage } from '../../../i18n';
import {
  confirmedBody,
  defaultPresenter,
  type BookingAttemptContext,
  type PaymentResolution,
  type PaySettlement,
} from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import { scheduleCheckInReminder } from '../../bookings';
import { presentBookingOutcome } from '../register';

jest.mock('../../../components/ui/Dialog', () => ({
  ...jest.requireActual('../../../components/ui/Dialog'),
  showDialog: jest.fn(),
}));
jest.mock('../../bookings', () => ({ scheduleCheckInReminder: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../payments', () => ({ ...jest.requireActual('../../../payments'), defaultPresenter: jest.fn() }));

const STARTS_AT = '2030-03-14T10:00:00Z';
const actions = { checkAgain: () => undefined };
const refreshCredits = jest.fn(() => Promise.resolve());

function resolution(
  booking: Partial<BookingAttemptContext>,
  settlement: PaySettlement = {
    kind: 'fulfilled',
    confirmation: {
      status: 'fulfilled',
      bookingId: '7a1c2b3d-0000-4000-8000-000000000010',
      checkInId: null,
      reason: null,
      awaitingPayment: false,
      ratingPrompt: null,
      lifetimeCheckIns: null,
    },
  },
): PaymentResolution {
  return {
    rail: 'booking',
    record: {
      v: 1,
      attemptId: 'attempt-1',
      memberId: '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22',
      startedAt: new Date().toISOString(),
      rail: 'booking',
      key: 'key-attempt-1',
      amountIsk: 1_990,
      booking: { kind: 'slot', activityId: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', startsAt: STARTS_AT, ...booking },
    },
    settlement,
  };
}

beforeEach(() => {
  setCurrentLanguage('en');
  jest.mocked(showDialog).mockClear();
  jest.mocked(scheduleCheckInReminder).mockClear();
  jest.mocked(defaultPresenter).mockClear();
  refreshCredits.mockClear();
  useAppStore.setState({ refreshCredits });
});

it('a paid class is confirmed with the class line, reminded by its name, and the plan refreshed', () => {
  presentBookingOutcome(resolution({ kind: 'class', eventId: 4242, className: 'Hot Yoga', activityName: 'Hress' }), actions);

  expect(showDialog).toHaveBeenCalledTimes(1);
  expect(jest.mocked(showDialog).mock.calls[0][0]).toMatchObject({
    title: lookup('booking.confirmed_title', 'en'),
    message: confirmedBody(true, true, 'en'),
    buttons: [{ label: lookup('common.done', 'en') }],
  });
  expect(confirmedBody(true, true, 'en')).toContain(lookup('booking.reminder.inline_paid', 'en'));
  expect(scheduleCheckInReminder).toHaveBeenCalledWith({ className: 'Hot Yoga', startsAt: new Date(STARTS_AT), language: 'en' });
  expect(refreshCredits).toHaveBeenCalledTimes(1);
  expect(defaultPresenter).not.toHaveBeenCalled();
});

it("a paid slot says the booking line, and with no class name is reminded by the activity's", () => {
  setCurrentLanguage('is');
  presentBookingOutcome(resolution({ kind: 'slot', className: '  ', activityName: 'Sky Lagoon' }), actions);

  expect(jest.mocked(showDialog).mock.calls[0][0]).toMatchObject({
    title: lookup('booking.confirmed_title', 'is'),
    message: confirmedBody(true, false, 'is'),
  });
  expect(confirmedBody(true, false, 'is')).toContain(lookup('booking.reminder.inline_paid_booking', 'is'));
  expect(scheduleCheckInReminder).toHaveBeenCalledWith({ className: 'Sky Lagoon', startsAt: new Date(STARTS_AT), language: 'is' });
  expect(refreshCredits).toHaveBeenCalledTimes(1);
});

it('a record with no readable start is confirmed but not reminded', () => {
  presentBookingOutcome(resolution({ kind: 'slot', activityName: 'Spin', startsAt: 'not a date' }), actions);
  expect(showDialog).toHaveBeenCalledTimes(1);
  expect(scheduleCheckInReminder).not.toHaveBeenCalled();
  expect(refreshCredits).toHaveBeenCalledTimes(1);
});

it("every other ending is F8's default alert: no confirmation, no reminder, no refresh", () => {
  const pending = resolution({ kind: 'class', className: 'Hot Yoga' }, { kind: 'outcome', outcome: { kind: 'processing' } });
  presentBookingOutcome(pending, actions);
  expect(defaultPresenter).toHaveBeenCalledWith(pending, actions);
  expect(showDialog).not.toHaveBeenCalled();
  expect(scheduleCheckInReminder).not.toHaveBeenCalled();
  expect(refreshCredits).not.toHaveBeenCalled();
});
