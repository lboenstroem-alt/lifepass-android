/**
 * The hosted-page confirm and the visit rating (API 0.46.0): a fulfilled
 * WALK-IN's answer carries `ratingPrompt` and `lifetimeCheckIns`, read
 * fail-soft and reported wherever the confirm settles (a live flow, Check
 * again, the recovery after a cold start); a booking's never reports, and
 * the confirm says the app shows the ask (`X-LifePass-Features`).
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { onCheckInFacts, type CheckInFacts } from '../../checkin/checkInFacts';
import { decodePaymentConfirmation, resetPaymentSessionsForTests, settlePaymentSession } from '../bookingPaymentSession';
import { NO_WAITS, setPaymentTimingForTests } from '../timing';

stubApiClientPerTest();

const CHECK_IN_ID = '9d7c1b2a-0000-4000-8000-000000000001';
const RATING_PROMPT = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  venueId: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f',
  venueName: 'Sky Lagoon',
  dueAt: '2026-10-27T13:05:00.000Z',
  expiresAt: '2026-10-30T13:05:00.000Z',
};

const reported: CheckInFacts[] = [];
let stop: () => void = () => undefined;

beforeEach(() => {
  setPaymentTimingForTests(NO_WAITS);
  resetPaymentSessionsForTests();
  reported.length = 0;
  stop = onCheckInFacts('payments.test', (facts) => reported.push(facts));
});

afterEach(() => {
  stop();
  setPaymentTimingForTests(null);
});

it('reads the ask and the count fail-soft (a booking, an older server: null)', () => {
  const walkIn = decodePaymentConfirmation({ status: 'fulfilled', checkInId: CHECK_IN_ID, ratingPrompt: RATING_PROMPT, lifetimeCheckIns: 5 });
  expect(walkIn.ratingPrompt?.venueName).toBe('Sky Lagoon');
  expect(walkIn.lifetimeCheckIns).toBe(5);
  const booking = decodePaymentConfirmation({ status: 'fulfilled', bookingId: CHECK_IN_ID });
  expect(booking.ratingPrompt).toBeNull();
  expect(booking.lifetimeCheckIns).toBeNull();
  const garbled = decodePaymentConfirmation({ status: 'fulfilled', checkInId: CHECK_IN_ID, ratingPrompt: { id: 1 }, lifetimeCheckIns: -2 });
  expect(garbled.ratingPrompt).toBeNull();
  expect(garbled.lifetimeCheckIns).toBeNull();
  expect(garbled.status).toBe('fulfilled');
});

it('a fulfilled walk-in reports its ask, once, and the confirm says the app shows it', async () => {
  api.on(
    'POST',
    '/bookings/payment-sessions/confirm',
    Reply.ok({ status: 'fulfilled', checkInId: CHECK_IN_ID, ratingPrompt: RATING_PROMPT, lifetimeCheckIns: 5 }),
  );
  const settlement = await settlePaymentSession({ key: 'walkin-key-1', leg: 'done' });
  expect(settlement.kind).toBe('fulfilled');
  expect(reported).toHaveLength(1);
  expect(reported[0].ratingPrompt?.id).toBe(RATING_PROMPT.id);
  expect(reported[0].lifetimeCheckIns).toBe(5);
  expect(api.sent('/bookings/payment-sessions/confirm', 'POST').headers['x-lifepass-features']).toBe('visit-rating-prompts');
});

it('a fulfilled booking, and anything not fulfilled, reports nothing', async () => {
  api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'fulfilled', bookingId: CHECK_IN_ID }));
  await settlePaymentSession({ key: 'booking-key-1', leg: 'done' });
  api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'refunded', reason: 'card_not_saved' }));
  await settlePaymentSession({ key: 'walkin-key-2', leg: 'cancel' });
  expect(reported).toEqual([]);
});
