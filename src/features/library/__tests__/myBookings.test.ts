/**
 * My bookings' state (iOS MyBookingsViewModel), against the stub server.
 *
 * The cancel cases port iOS `CancelRefusalTests` (LifePassTests/
 * MemberRefusalTests.swift, 2.5.5) case for case: one request per tap, one
 * key per booking until the server answers it for good, and each refusal in
 * its own words with its own next step.
 */
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { ActionKeys, errorMessage, HttpStatusError, ProblemError, TransportError } from '../../../api';
import type { MemberBooking } from '../../../api/bookingsList';
import { installStubApiClient, stubApiClientPerTest } from '../../../api/testing';
import { t } from '../../../i18n';
import { createMyBookingsStore, endsTheAttempt, sortByStart, type MyBookingsDeps } from '../bookings/myBookings';

stubApiClientPerTest();

const BOOKING_ID = '7a1c2b3d-0000-4000-8000-0000000000aa';
const VENUE_ID = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

const booking: MemberBooking = {
  id: BOOKING_ID,
  status: 'confirmed',
  startsAt: new Date(Date.now() + 86_400_000),
  endsAt: new Date(Date.now() + 90_000_000),
  cancelledAt: null,
  cancellationReason: null,
  venue: { id: VENUE_ID, slug: 'world-class-vatnsmyri', name: 'World Class Vatnsmýri' },
  activity: null,
  externalTitle: 'Yoga Flow',
  location: null,
};

const emptyPage: StubReply = Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } });

function rowJSON(id: string, startsAt: string, status = 'confirmed') {
  return {
    id,
    status,
    startsAt,
    endsAt: startsAt,
    cancelledAt: null,
    cancellationReason: null,
    venue: { id: VENUE_ID, slug: 'laugar', name: 'Laugar' },
    activity: null,
    externalTitle: null,
    location: null,
    venueReference: null,
  };
}

const pageOf = (rows: unknown[]): StubReply =>
  Reply.ok({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } });

/** Every cancel the phone sent. */
const cancels = (): StubRequest[] => api.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/cancel'));
const reads = (): StubRequest[] => api.requests.filter((r) => r.method === 'GET' && r.path === '/bookings');

/** Answers every cancel with `reply`, every list read with an empty page. */
function answerCancel(reply: () => StubReply) {
  api.on('POST', '/bookings/:id/cancel', () => reply());
  api.on('GET', '/bookings', emptyPage);
}

const cancelled = () => Reply.ok({ bookingId: BOOKING_ID, status: 'cancelled' });

function makeStore(overrides: Partial<MyBookingsDeps> = {}) {
  const cancelReminder = jest.fn();
  const store = createMyBookingsStore({ cancelReminder, ...overrides });
  return { store, cancelReminder };
}

describe('the cancel (iOS CancelRefusalTests)', () => {
  it('a double tap sends one cancel', async () => {
    answerCancel(cancelled);
    const { store } = makeStore();
    await Promise.all([store.getState().cancelBooking(booking), store.getState().cancelBooking(booking)]);

    expect(cancels()).toHaveLength(1);
    expect(store.getState().cancellingBookingId).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it('an uncertain cancel says so, and a retry replays the same key', async () => {
    answerCancel(() => Reply.problem(502, 'cancel_provider_uncertain'));
    const { store } = makeStore();

    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.cancel_uncertain'));
    expect(store.getState().error).not.toBe(t('refusal.cancel_window'));
    expect(store.getState().errorCta).toBe('myBookings');

    await store.getState().cancelBooking(booking);
    expect(cancels()).toHaveLength(2);
    const first = cancels()[0].headers['idempotency-key'];
    expect(first).toEqual(expect.any(String));
    expect(cancels()[1].headers['idempotency-key']).toBe(first);
  });

  it('a closed window is final, and a later cancel is a new attempt', async () => {
    answerCancel(() => Reply.problem(409, 'cancellation_window_closed'));
    const { store } = makeStore();

    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.cancel_window'));
    expect(store.getState().errorCta).toBe('contactSupport');

    store.getState().dismissError();
    await store.getState().retryCancel();
    expect(cancels()).toHaveLength(2);
    expect(cancels()[0].headers['idempotency-key']).not.toBe(cancels()[1].headers['idempotency-key']);
  });

  it('a booking that went away reads as not cancellable, with Refresh', async () => {
    answerCancel(() => Reply.problem(404, 'booking_not_found'));
    const { store } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.not_cancellable'));
    expect(store.getState().errorCta).toBe('refreshBookings');
  });

  it('an offline cancel keeps its key and reads as offline', async () => {
    const session = installStubApiClient({ isDeviceOffline: async () => true });
    try {
      let calls = 0;
      answerCancel(() => {
        calls += 1;
        return calls === 1 ? Reply.fail() : cancelled();
      });
      const { store } = makeStore();

      await store.getState().cancelBooking(booking);
      expect(store.getState().error).toBe(t('error.offline'));
      expect(store.getState().errorCta).toBeNull();

      await store.getState().cancelBooking(booking);
      expect(cancels()).toHaveLength(2);
      expect(cancels()[0].headers['idempotency-key']).toBe(cancels()[1].headers['idempotency-key']);
    } finally {
      session.restore();
    }
  });

  it('a payment still being confirmed reads as cancel pending, with Contact support', async () => {
    answerCancel(() => Reply.problem(409, 'booking_charge_unresolved'));
    const { store } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.cancel_pending'));
    expect(store.getState().errorCta).toBe('contactSupport');
  });

  it('a failed cancel offers Try again, which is the same cancel under the same key', async () => {
    let calls = 0;
    answerCancel(() => {
      calls += 1;
      return calls === 1 ? Reply.problem(500, 'booking_cancel_failed') : cancelled();
    });
    const { store, cancelReminder } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.cancel_failed'));
    expect(store.getState().errorCta).toBe('tryAgain');

    store.getState().dismissError();
    await store.getState().retryCancel();
    expect(cancels()).toHaveLength(2);
    expect(cancels()[0].headers['idempotency-key']).toBe(cancels()[1].headers['idempotency-key']);
    expect(store.getState().error).toBeNull();
    expect(cancelReminder).toHaveBeenCalledTimes(1);
  });

  it('never shows the server words', async () => {
    answerCancel(() => Reply.problem(409, 'cancellation_window_closed', { detail: 'internal: deadline 2h' }));
    const { store } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(store.getState().error).not.toMatch(/internal|deadline 2h|cancellation_window_closed/);
  });
});

describe('the cancel, around the answer', () => {
  it('on success removes the class reminders by its start, then reloads', async () => {
    answerCancel(cancelled);
    const { store, cancelReminder } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(cancelReminder).toHaveBeenCalledWith(booking.startsAt);
    expect(reads()).toHaveLength(2);
    // The order: the cancel, then the two reads.
    expect(api.requests[0].method).toBe('POST');
  });

  it('a success ends the attempt: the next cancel of that booking has a new key', async () => {
    answerCancel(cancelled);
    const keys = new ActionKeys();
    const { store } = makeStore({ keys });
    await store.getState().cancelBooking(booking);
    expect(keys.peek(BOOKING_ID)).toBeUndefined();
    await store.getState().cancelBooking(booking);
    expect(cancels()[0].headers['idempotency-key']).not.toBe(cancels()[1].headers['idempotency-key']);
  });

  it('a refusal the server answered reloads the list first, then shows the alert', async () => {
    answerCancel(() => Reply.problem(409, 'booking_not_cancellable'));
    const { store, cancelReminder } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(reads()).toHaveLength(2);
    expect(cancelReminder).not.toHaveBeenCalled();
    expect(store.getState().error).toBe(t('refusal.not_cancellable'));
  });

  it('a reload that fails after a refusal never replaces the refusal', async () => {
    api.on('POST', '/bookings/:id/cancel', Reply.problem(409, 'cancellation_window_closed'));
    api.on('GET', '/bookings', Reply.problem(500, 'internal_error'));
    const { store } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(store.getState().error).toBe(t('refusal.cancel_window'));
  });

  it('no answer at all does not reload (there is nothing new to show)', async () => {
    answerCancel(() => Reply.raw(502, '<html>bad gateway</html>'));
    const { store } = makeStore();
    await store.getState().cancelBooking(booking);
    expect(reads()).toHaveLength(0);
    expect(store.getState().error).toBe(t('error.server'));
    expect(store.getState().errorCta).toBeNull();
  });

  it('a cancel answered during a pull reads the list again once the pull is done', async () => {
    // The pull's reads are held until after the cancel has landed, and answer
    // with the booking still confirmed (read before the cancel). The cancel's
    // reload must not be swallowed by the pull's re-entry guard.
    const held: (() => void)[] = [];
    let calls = 0;
    api.on('GET', '/bookings', (request) => {
      calls += 1;
      if (calls > 2) return emptyPage;
      const stale = request.query.range === 'upcoming' ? pageOf([rowJSON(BOOKING_ID, '2030-03-14T10:00:00Z')]) : emptyPage;
      return new Promise<StubReply>((resolve) => held.push(() => resolve(stale)));
    });
    api.on('POST', '/bookings/:id/cancel', cancelled);
    const { store } = makeStore();

    const pull = store.getState().load();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getState().isLoading).toBe(true);

    const cancelling = store.getState().cancelBooking(booking);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancels()).toHaveLength(1);
    held.forEach((release) => release());
    await Promise.all([pull, cancelling]);

    expect(reads()).toHaveLength(4);
    // The last two reads went out after the cancel.
    const cancelAt = api.requests.findIndex((r) => r.method === 'POST');
    expect(api.requests.slice(cancelAt + 1).filter((r) => r.method === 'GET')).toHaveLength(2);
    expect(store.getState().upcoming).toHaveLength(0);
    expect(store.getState().isLoading).toBe(false);
  });

  it('a refusal answered during a pull also reads the list again after it', async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    api.on('GET', '/bookings', () => {
      calls += 1;
      if (calls > 2) return emptyPage;
      return new Promise<StubReply>((resolve) => {
        const previous = release;
        release = () => {
          previous();
          resolve(emptyPage);
        };
      });
    });
    api.on('POST', '/bookings/:id/cancel', Reply.problem(404, 'booking_not_found'));
    const { store } = makeStore();

    const pull = store.getState().load();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelling = store.getState().cancelBooking(booking);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([pull, cancelling]);

    expect(reads()).toHaveLength(4);
    expect(store.getState().error).toBe(t('refusal.not_cancellable'));
  });

  it('keeps every cancel button waiting while one is in flight', async () => {
    let release: () => void = () => undefined;
    api.on('POST', '/bookings/:id/cancel', () => new Promise<StubReply>((resolve) => (release = () => resolve(cancelled()))));
    api.on('GET', '/bookings', emptyPage);
    const { store } = makeStore();
    const running = store.getState().cancelBooking(booking);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getState().cancellingBookingId).toBe(BOOKING_ID);
    // Another booking's cancel is dropped meanwhile.
    await store.getState().cancelBooking({ ...booking, id: VENUE_ID });
    release();
    await running;
    expect(cancels()).toHaveLength(1);
    expect(store.getState().cancellingBookingId).toBeNull();
  });
});

describe('the load', () => {
  it('reads both halves and sorts Upcoming soonest first, Past newest first', async () => {
    api.on('GET', '/bookings', (request) =>
      request.query.range === 'upcoming'
        ? pageOf([
            rowJSON('00000000-0000-4000-8000-000000000003', '2030-03-16T10:00:00Z'),
            rowJSON('00000000-0000-4000-8000-000000000001', '2030-03-14T10:00:00Z'),
            rowJSON('00000000-0000-4000-8000-000000000002', '2030-03-15T10:00:00Z'),
          ])
        : pageOf([
            rowJSON('00000000-0000-4000-8000-000000000004', '2026-01-01T10:00:00Z', 'completed'),
            rowJSON('00000000-0000-4000-8000-000000000005', '2026-03-01T10:00:00Z', 'no_show'),
          ]),
    );
    const { store } = makeStore();
    await store.getState().load();
    expect(store.getState().upcoming.map((b) => b.id.slice(-1))).toEqual(['1', '2', '3']);
    expect(store.getState().past.map((b) => b.id.slice(-1))).toEqual(['5', '4']);
    expect(reads().map((r) => r.query)).toEqual(
      expect.arrayContaining([
        { range: 'upcoming', limit: '100' },
        { range: 'past', limit: '100' },
      ]),
    );
  });

  it('is guarded against re-entry: a focus and a pull together send one pair of reads', async () => {
    api.on('GET', '/bookings', emptyPage);
    const { store } = makeStore();
    await Promise.all([store.getState().load(), store.getState().load()]);
    expect(reads()).toHaveLength(2);
    expect(store.getState().isLoading).toBe(false);
  });

  it('a failed read shows the error as the formatter words it, and keeps the lists', async () => {
    api.on('GET', '/bookings', pageOf([rowJSON(BOOKING_ID, '2030-03-14T10:00:00Z')]));
    const { store } = makeStore();
    await store.getState().load();
    api.on('GET', '/bookings', Reply.raw(503, '<html>unavailable</html>'));
    await store.getState().load();
    // iOS ErrorFormatter.message, not the refusal table: nothing was refused.
    expect(store.getState().error).toBe(errorMessage(new HttpStatusError(503, '')));
    expect(store.getState().errorCta).toBeNull();
    expect(store.getState().upcoming).toHaveLength(1);
  });

  it('a read the app called off is never an alert', async () => {
    api.on('GET', '/bookings', emptyPage);
    const { store } = makeStore({
      fetch: () => Promise.reject(new TransportError('cancelled')),
    });
    await store.getState().load();
    expect(store.getState().error).toBeNull();
  });

  it('a failed Past still takes the new Upcoming, as iOS assigns them in turn', async () => {
    api.on('GET', '/bookings', (request) =>
      request.query.range === 'upcoming' ? pageOf([rowJSON(BOOKING_ID, '2030-03-14T10:00:00Z')]) : Reply.problem(500, 'internal_error'),
    );
    const { store } = makeStore();
    await store.getState().load();
    expect(store.getState().upcoming).toHaveLength(1);
    expect(store.getState().error).not.toBeNull();
  });
});

describe('the rules', () => {
  it('ends the attempt only on a problem the server meant (a status under 500)', () => {
    const problem = (status?: number) => new ProblemError({ type: 'https://lifepass.is/problems/x', status }, status ?? 400);
    expect(endsTheAttempt(problem(409))).toBe(true);
    expect(endsTheAttempt(problem(404))).toBe(true);
    expect(endsTheAttempt(problem(502))).toBe(false);
    expect(endsTheAttempt(problem(undefined))).toBe(false);
    expect(endsTheAttempt(new TransportError('timeout'))).toBe(false);
    expect(endsTheAttempt(new TransportError('offline'))).toBe(false);
    expect(endsTheAttempt(new Error('x'))).toBe(false);
  });

  it('sorts stably', () => {
    const a = { ...booking, id: 'a' };
    const b = { ...booking, id: 'b' };
    expect(sortByStart([a, b], 'ascending').map((x) => x.id)).toEqual(['a', 'b']);
    expect(sortByStart([a, b], 'descending').map((x) => x.id)).toEqual(['a', 'b']);
  });
});
