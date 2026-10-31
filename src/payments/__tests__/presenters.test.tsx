/**
 * When an outcome the screen could not show is shown: only once the app's
 * tabs are on screen and no hosted page is in the way, one per attempt, to
 * the member who paid; the reminders only through F7's shim; and the
 * "Confirming your payment…" overlay a cold start's recovery shows.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { runSignOutCleaners } from '../../app/signOut';
import { DialogHost } from '../../components/ui/Dialog';
import { lookup } from '../../i18n';
import { scheduleBookingReminders } from '../../services/notifications';
import { useAppStore } from '../../stores/appStore';
import type { BookingInflight } from '../inflight';
import {
  flushPresentations,
  holdPresentations,
  presentResolution,
  setShellReadyForTests,
  type PaymentResolution,
} from '../presenters';
import { endRecoveryProgress, startRecoveryProgress, visibleRecoveryProgress } from '../recoveryProgress';
import RecoveryProgressHost from '../RecoveryProgressHost';

import { freshPaymentsPerTest, MEMBER_A, MEMBER_B, signIn } from './paymentsHarness';

// The first build's notification shim (no `classReminderIdentifiers`): English
// reminders a day and an hour ahead, which must never be scheduled.
jest.mock('../../services/notifications', () => ({
  scheduleBookingReminders: jest.fn(() => Promise.resolve()),
}));

freshPaymentsPerTest();

const record = (attemptId = 'attempt-1', memberId = MEMBER_A): BookingInflight => ({
  v: 1,
  attemptId,
  memberId,
  startedAt: new Date().toISOString(),
  rail: 'booking',
  key: `key-${attemptId}`,
  amountIsk: 1_990,
  booking: {
    kind: 'class',
    activityId: '7a1c2b3d-0000-4000-8000-0000000000aa',
    eventId: 4242,
    className: 'Hot yoga',
    startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
});

const booked = (attemptId?: string, memberId?: string): PaymentResolution => ({
  rail: 'booking',
  record: record(attemptId, memberId),
  settlement: {
    kind: 'fulfilled',
    confirmation: {
      status: 'fulfilled',
      bookingId: '7a1c2b3d-0000-4000-8000-000000000010',
      checkInId: null,
      reason: null,
      awaitingPayment: false,
    },
  },
});

const stillConfirming = (attemptId?: string): PaymentResolution => ({
  rail: 'booking',
  record: record(attemptId),
  settlement: { kind: 'outcome', outcome: { kind: 'processing' } },
});

const actions = { checkAgain: () => undefined };
const confirmedTitle = () => lookup('booking.confirmed_title', 'en');

beforeEach(() => signIn());

describe('when an outcome is shown', () => {
  it('waits until the app’s tabs are on screen', async () => {
    let ready = false;
    setShellReadyForTests(() => ready);
    await render(<DialogHost />);
    await act(() => presentResolution(booked(), actions));
    expect(screen.queryByText(confirmedTitle())).toBeNull();
    ready = true;
    await act(() => flushPresentations());
    expect(screen.getByText(confirmedTitle())).toBeTruthy();
  });

  it('a later answer for the same attempt replaces one still waiting', async () => {
    let ready = false;
    setShellReadyForTests(() => ready);
    await render(<DialogHost />);
    await act(() => presentResolution(stillConfirming('a1'), actions));
    await act(() => presentResolution(booked('a1'), actions));
    ready = true;
    await act(() => flushPresentations());
    expect(screen.queryByText(lookup('booking.pay.processing_title', 'en'))).toBeNull();
    expect(screen.getByText(confirmedTitle())).toBeTruthy();
    await fireEvent.press(screen.getByText(lookup('common.done', 'en')));
    expect(screen.queryByText(confirmedTitle())).toBeNull();
  });

  it('waits while a flow has a hosted page up, then shows', async () => {
    await render(<DialogHost />);
    const release = holdPresentations();
    await act(() => presentResolution(booked(), actions));
    expect(screen.queryByText(confirmedTitle())).toBeNull();
    await act(() => release());
    expect(screen.getByText(confirmedTitle())).toBeTruthy();
    // Releasing twice changes nothing.
    await act(() => release());
  });

  it('what waits goes at sign-out, and is never shown to the next member', async () => {
    let ready = false;
    setShellReadyForTests(() => ready);
    await render(<DialogHost />);
    await act(() => presentResolution(booked('a1'), actions));
    await act(() => runSignOutCleaners({ memberId: MEMBER_A }));
    await act(() => presentResolution(booked('a2'), actions));
    // Someone else signs in before it could be shown.
    signIn(MEMBER_B);
    ready = true;
    await act(() => flushPresentations());
    expect(screen.queryByText(confirmedTitle())).toBeNull();
    expect(useAppStore.getState().userId).toBe(MEMBER_B);
  });
});

describe('the check-in reminders', () => {
  it('are not scheduled through the first build’s shim', async () => {
    await render(<DialogHost />);
    await act(() => presentResolution(booked(), actions));
    expect(screen.getByText(confirmedTitle())).toBeTruthy();
    expect(scheduleBookingReminders).not.toHaveBeenCalled();
  });
});

describe('"Confirming your payment…"', () => {
  it('draws iOS’s overlay while the recovery confirms; Cancel hides it and the check goes on', async () => {
    await render(<RecoveryProgressHost />);
    await act(() => startRecoveryProgress({ attemptId: 'a1', rail: 'plan' }));
    expect(screen.getByText(lookup('plans.confirming', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('plans.confirming_sub', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(lookup('common.cancel', 'en')));
    expect(screen.queryByText(lookup('plans.confirming', 'en'))).toBeNull();
    // Still being confirmed: only hidden.
    await act(() => endRecoveryProgress('a1'));
    expect(visibleRecoveryProgress()).toBeNull();
  });

  it('goes when that attempt is done, and not for another one', async () => {
    await render(<RecoveryProgressHost />);
    await act(() => startRecoveryProgress({ attemptId: 'a1', rail: 'booking' }));
    await act(() => endRecoveryProgress('another'));
    expect(screen.getByText(lookup('plans.confirming', 'en'))).toBeTruthy();
    await act(() => endRecoveryProgress('a1'));
    expect(screen.queryByText(lookup('plans.confirming', 'en'))).toBeNull();
  });
});
