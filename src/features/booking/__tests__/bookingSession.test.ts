/**
 * The booking session against the stub server: the ported iOS
 * BookingMoneyPathTests and the booking-flow money cases of
 * ClassBookingSheetTests (the full flow and the class sheet's single
 * session share the session). They assert what the phone ASKS and SENDS,
 * and what it tells the member, never the server's words.
 */
import { api, Reply, type StubReply } from '@test/server';

import { API_TIMEOUTS, apiClient, apiPost } from '../../../api/client';
import { createBookingBody, decodeCreateBookingResult, makeSlot, type CreateBookingInput } from '../../../api/bookings';
import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../i18n';
import {
  bookingInProgress,
  canConfirmOccurrence,
  confirmChargeIsk,
  DECLINED_ATTEMPT_CODES,
  guestBandsFromCounts,
  loadsInitialDayOnAppear,
  needsMembership,
  visitChoiceOptions,
} from '../bookingSession';
import {
  ABLER,
  ablerOccurrence,
  ACTIVITY_ID,
  BOKUN,
  bodyOf,
  bookingPosts,
  classesReply,
  CONFIRMED,
  consent,
  FIRST_PARTY,
  FREE_PREVIEW,
  FULL_SNAPSHOT,
  iso,
  klass,
  OPEN_SNAPSHOT,
  plus,
  requests,
  respond,
  RUNG_CHOICE_PREVIEW,
  slotOccurrence,
  slotsReply,
  START,
  SURCHARGE_PREVIEW,
  testSession,
  VENUE_DAY,
  type TestSession,
} from './bookingHarness';

stubApiClientPerTest();

beforeEach(() => setCurrentLanguage('en'));

const en = (key: string) => lookup(key, 'en');

/** The class-sheet world: one Abler class, a preview, and the create's reply. */
function classWorld(preview: unknown, create: () => StubReply = () => Reply.ok(CONFIRMED)) {
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(preview);
    if (request.method === 'POST' && request.path === '/bookings') return create();
    return Reply.problem(404, 'not_found');
  });
}

// ---------------------------------------------------------------------------
// BookingMoneyPathTests

describe('the money paths (BookingMoneyPathTests)', () => {
  const start = new Date('2030-10-02T14:00:00Z');
  const slot = makeSlot({
    activityId: ACTIVITY_ID,
    startTime: start,
    endTime: plus(start, 7200),
    isAvailable: true,
    remainingCapacity: 10,
    instructor: null,
    title: null,
  });

  function bokunSession(deps = {}) {
    const session = testSession({ activity: BOKUN, deps });
    session.store.getState().selectSlot(slot);
    return session;
  }

  it('a create waits longer than a minute (120 s) and books', async () => {
    // The app's own create (src/api/bookings.ts) through the real client:
    // the post is asked for the long ceiling, and the session books.
    expect(API_TIMEOUTS.bookingCreate).toBe(120_000);
    const post = jest.spyOn(apiClient, 'post');
    try {
      const { store } = bokunSession();
      respond(() => Reply.ok(CONFIRMED));
      await store.getState().confirmBooking();
      expect(store.getState().bookingComplete).toBe(true);
      const creates = post.mock.calls.filter(([path]) => path === '/bookings');
      expect(creates).toHaveLength(1);
      expect(creates[0][2]?.timeoutMs).toBe(120_000);
    } finally {
      post.mockRestore();
    }
  });

  it('a create with no answer is still waited on past a minute, and only at 120 s is the outcome unknown', async () => {
    // The 2.5.5 failure: a client that gives up at 60 s tells the member it
    // failed while the server is still booking and charging.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const { store } = bokunSession();
      respond(() => Reply.hang());
      const confirming = store.getState().confirmBooking();
      await jest.advanceTimersByTimeAsync(61_000);
      expect(bookingPosts()).toHaveLength(1);
      expect(store.getState().isBooking).toBe(true);
      expect(store.getState().bookingOutcomeUnknown).toBe(false);
      expect(store.getState().error).toBeNull();

      await jest.advanceTimersByTimeAsync(59_000);
      await confirming;
      expect(store.getState().bookingOutcomeUnknown).toBe(true);
      expect(store.getState().error).toBeNull();
      expect(store.getState().idempotencyKey).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a timeout is not a failure, and checking again can only return the same booking', async () => {
    // A short ceiling stands in for the 120 s; the body is the app's own.
    const { store } = bokunSession({
      createBooking: (input: CreateBookingInput, key: string) =>
        apiPost('/bookings', createBookingBody(input), { idempotencyKey: key, timeoutMs: 50, decode: decodeCreateBookingResult }),
    });
    let calls = 0;
    respond((request) => {
      if (request.path !== '/bookings') return Reply.problem(404, 'not_found');
      calls += 1;
      return calls === 1 ? Reply.hang() : Reply.ok(CONFIRMED);
    });
    await store.getState().confirmBooking();

    expect(store.getState().bookingOutcomeUnknown).toBe(true);
    expect(store.getState().error).toBeNull();
    expect(store.getState().bookingComplete).toBe(false);
    expect(bookingInProgress(store.getState())).toBe(true);

    await store.getState().checkBookingAgain();

    expect(store.getState().bookingComplete).toBe(true);
    const posts = bookingPosts();
    expect(posts).toHaveLength(2);
    expect(posts[0].headers['idempotency-key']).toBe(posts[1].headers['idempotency-key']);
    expect(posts[1].body).toEqual(posts[0].body);
  });

  it('a consent re-POST keeps the party and the key', async () => {
    const { store } = bokunSession();
    store.setState({ participants: 3 });
    let calls = 0;
    respond((request) => {
      if (request.path !== '/bookings') return Reply.problem(404, 'not_found');
      calls += 1;
      return calls === 1 ? consent(29_700) : Reply.ok(CONFIRMED);
    });
    await store.getState().confirmBooking();
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(29_700);

    await store.getState().acceptCharge();

    const posts = bookingPosts();
    expect(posts).toHaveLength(2);
    expect(bodyOf(posts[0]).participants).toBe(3);
    expect(bodyOf(posts[1]).participants).toBe(3);
    expect(bodyOf(posts[1]).acceptCharge).toBe(true);
    expect(bodyOf(posts[1]).acceptedChargeAmountIsk).toBe(29_700);
    expect(posts[0].headers['idempotency-key']).toBe(posts[1].headers['idempotency-key']);
    expect(store.getState().bookingComplete).toBe(true);
    expect(store.getState().bookingWasPaid).toBe(true);
  });

  it('a stranded capture is not called confirmed, and no reminder is scheduled for it', async () => {
    const { store, reminders } = bokunSession();
    respond(() => Reply.ok({ ...CONFIRMED, status: 'pending' }));
    await store.getState().confirmBooking();
    expect(store.getState().bookingComplete).toBe(false);
    expect(store.getState().bookingPendingConfirmation).toBe(true);
    expect(reminders).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The class sheet's single session (ClassBookingSheetTests)

describe('an Abler class', () => {
  it('books the tapped event, asking one venue day and the preview at its start', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) {
        return classesReply([klass(4241, plus(START, -7200)), klass(4242, START), klass(4243, plus(START, 7200))]);
      }
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store, reminders } = testSession();
    await store.getState().prepare(ablerOccurrence());

    const timetable = requests('/classes');
    expect(timetable).toHaveLength(1);
    expect(timetable[0].path).toBe(`/activities/${ACTIVITY_ID}/classes`);
    expect(timetable[0].query).toEqual({ start: VENUE_DAY, end: VENUE_DAY });

    const s = store.getState();
    expect(s.selectedClass?.eventId).toBe(4242);
    expect(s.occurrenceStatus).toBe('ready');
    expect(s.currentStep).toBe(2);
    expect(s.selectedClass?.coaches[0]?.firstName).toBe('Sigrún');
    expect(requests('/booking-preview')[0].query.startsAt).toBe(iso(START));
    expect(s.preview?.kind).toBe('free');
    expect(canConfirmOccurrence(s)).toBe(true);

    await store.getState().confirmBooking();

    const post = bookingPosts()[0];
    expect(bodyOf(post)).toEqual({ activityId: ACTIVITY_ID, eventId: 4242 });
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.getState().bookingComplete).toBe(true);
    expect(store.getState().bookingWasPaid).toBe(false);
    expect(bookingPosts()).toHaveLength(1);
    // The check-in reminders, keyed on the class's start, named after it.
    expect(reminders).toHaveBeenCalledWith({ className: 'Class 4242', startsAt: START, language: 'en' });
  });

  it('a charge consent re-POST keeps the event and the key, and holds the screen while it is up', async () => {
    let posts = 0;
    classWorld(SURCHARGE_PREVIEW, () => {
      posts += 1;
      return posts === 1 ? consent(1_990) : Reply.ok(CONFIRMED);
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(bookingInProgress(store.getState())).toBe(false);
    await store.getState().confirmBooking();
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1_990);
    expect(bookingInProgress(store.getState())).toBe(true);

    await store.getState().acceptCharge();
    expect(bookingInProgress(store.getState())).toBe(false);
    const all = bookingPosts();
    expect(all).toHaveLength(2);
    expect(bodyOf(all[1])).toEqual({ activityId: ACTIVITY_ID, eventId: 4242, acceptCharge: true, acceptedChargeAmountIsk: 1_990 });
    expect(all[0].headers['idempotency-key']).toBe(all[1].headers['idempotency-key']);
    expect(store.getState().bookingComplete).toBe(true);
  });

  it('a class that left the schedule cannot be confirmed', async () => {
    respond((request) =>
      request.path.endsWith('/classes') ? classesReply([klass(4241, plus(START, -3600))]) : Reply.problem(404, 'not_found'),
    );
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().occurrenceStatus).toBe('gone');
    expect(store.getState().selectedClass).toBeNull();
    expect(canConfirmOccurrence(store.getState())).toBe(false);
    expect(requests('/booking-preview')).toHaveLength(0);
    await store.getState().confirmBooking();
    expect(bookingPosts()).toHaveLength(0);
  });

  it('a full class says so and is not previewed', async () => {
    respond((request) =>
      request.path.endsWith('/classes')
        ? classesReply([klass(4242, START, { canBook: false, reason: 'class_full', full: true })])
        : Reply.problem(404, 'not_found'),
    );
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().occurrenceStatus).toBe('notBookable');
    expect(store.getState().selectedClass?.canBookReason).toBe('class_full');
    expect(canConfirmOccurrence(store.getState())).toBe(false);
    expect(requests('/booking-preview')).toHaveLength(0);
  });

  it('a failed re-check stays best effort with the seeded event', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) return Reply.problem(500, 'internal_error');
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().occurrenceStatus).toBe('ready');
    expect(store.getState().selectedClass?.eventId).toBe(4242);
    expect(store.getState().error).toBeNull();
    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0]).eventId).toBe(4242);
  });

  it('an already booked class is refused at disclosure, with Confirm hidden', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      if (request.path.endsWith('/booking-preview')) return Reply.problem(409, 'slot_already_booked');
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().gateRefusal?.messageKey).toBe('booking.err.slot_dup');
    expect(canConfirmOccurrence(store.getState())).toBe(false);
  });

  it('no plan offers plans; closing plans after buying one lets the same class be confirmed', async () => {
    let bought = false;
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      if (request.path.endsWith('/booking-preview')) {
        return bought ? Reply.ok(FREE_PREVIEW) : Reply.problem(403, 'no_active_plan_or_pass');
      }
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().gateRefusal?.messageKey).toBe('booking.err.no_plan');
    expect(needsMembership(store.getState().gateRefusal)).toBe(true);
    expect(canConfirmOccurrence(store.getState())).toBe(false);

    bought = true;
    await store.getState().recheckAfterPlans();
    expect(store.getState().gateRefusal).toBeNull();
    expect(store.getState().occurrenceStatus).toBe('ready');
    expect(store.getState().preview?.kind).toBe('free');
    expect(requests('/classes')).toHaveLength(2);
    expect(canConfirmOccurrence(store.getState())).toBe(true);

    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0]).eventId).toBe(4242);
    expect(store.getState().bookingComplete).toBe(true);
  });

  it('closing plans over a refusal a plan cannot answer asks nothing', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      if (request.path.endsWith('/booking-preview')) return Reply.problem(409, 'slot_already_booked');
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    const asked = api.requests.length;
    await store.getState().recheckAfterPlans();
    expect(api.requests).toHaveLength(asked);
    expect(store.getState().gateRefusal?.messageKey).toBe('booking.err.slot_dup');
  });

  it('a class or slot the row showed as Full stays Full when the re-check fails', async () => {
    respond(() => Reply.problem(500, 'internal_error'));
    const first = testSession();
    await first.store.getState().prepare(ablerOccurrence({ snapshot: FULL_SNAPSHOT }));
    expect(first.store.getState().occurrenceStatus).toBe('notBookable');
    await first.store.getState().confirmBooking();

    const second = testSession();
    await second.store.getState().prepare(slotOccurrence(plus(START, 2700), FULL_SNAPSHOT));
    expect(second.store.getState().occurrenceStatus).toBe('notBookable');
    expect(second.store.getState().selectedSlot?.remainingCapacity).toBe(0);
    await second.store.getState().confirmBooking();

    expect(requests('/booking-preview')).toHaveLength(0);
    expect(bookingPosts()).toHaveLength(0);
  });

  it("an open slot stays best effort when the re-check fails, with the row's spots", async () => {
    respond((request) =>
      request.path.endsWith('/booking-preview') ? Reply.ok(FREE_PREVIEW) : Reply.problem(500, 'internal_error'),
    );
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700), OPEN_SNAPSHOT));
    expect(store.getState().occurrenceStatus).toBe('ready');
    expect(store.getState().selectedSlot?.remainingCapacity).toBe(9);
    expect(canConfirmOccurrence(store.getState())).toBe(true);
  });

  it('a class that fills after the check is refused honestly, in place', async () => {
    classWorld(FREE_PREVIEW, () => Reply.problem(409, 'slot_unavailable', { reason: 'class_full' }));
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().gateRefusal?.messageKey).toBe('booking.class.err_full');
    expect(store.getState().bookingComplete).toBe(false);
    expect(canConfirmOccurrence(store.getState())).toBe(false);
  });

  it('a started class is neither checked nor offered', async () => {
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence({ startsAt: new Date(Date.now() - 600_000) }));
    expect(store.getState().occurrenceStatus).toBe('started');
    expect(canConfirmOccurrence(store.getState())).toBe(false);
    expect(api.requests).toHaveLength(0);
  });

  it('a class that starts while the sheet is open stops being bookable', async () => {
    classWorld(FREE_PREVIEW);
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    store.getState().tickOccurrence(plus(START, -1));
    expect(store.getState().occurrenceStatus).toBe('ready');
    store.getState().tickOccurrence(plus(START, 1));
    expect(store.getState().occurrenceStatus).toBe('started');
    expect(canConfirmOccurrence(store.getState())).toBe(false);
  });
});

describe('a first-party slot', () => {
  it('books its own times, asked on one venue day for one person', async () => {
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([plus(START, -3600), START, plus(START, 3600)]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700)));
    expect(requests('/availability')[0].query).toEqual({ start: VENUE_DAY, end: VENUE_DAY, participants: '1' });
    expect(store.getState().selectedSlot?.startTime).toEqual(START);
    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0])).toEqual({
      activityId: ACTIVITY_ID,
      startsAt: iso(START),
      endsAt: iso(plus(START, 2700)),
    });
  });

  it("a class sold as a slot is reminded by the class's name, never the activity's", async () => {
    // iOS ClassBookingSheet passes `occurrence.className ?? activity.name`.
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store, reminders } = testSession();
    await store.getState().prepare({ ...slotOccurrence(plus(START, 2700)), className: 'Hot Yoga' });
    await store.getState().confirmBooking();
    expect(store.getState().bookingComplete).toBe(true);
    expect(reminders).toHaveBeenCalledWith({ className: 'Hot Yoga', startsAt: START, language: 'en' });

    // With no class name, the activity's (the full flow's title).
    api.reset();
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const unnamed = testSession();
    await unnamed.store.getState().prepare({ ...slotOccurrence(plus(START, 2700)), className: null });
    await unnamed.store.getState().confirmBooking();
    expect(unnamed.reminders).toHaveBeenCalledWith({ className: FIRST_PARTY.name, startsAt: START, language: 'en' });
  });

  it('a Coach slot with no end takes it from the re-check, and is never booked blind', async () => {
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(null));
    expect(store.getState().occurrenceStatus).toBe('ready');
    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0]).endsAt).toBe(iso(plus(START, 2700)));

    api.reset();
    respond(() => Reply.problem(500, 'internal_error'));
    const blind = testSession();
    await blind.store.getState().prepare(slotOccurrence(null));
    expect(blind.store.getState().occurrenceStatus).toBe('unresolved');
    await blind.store.getState().confirmBooking();
    expect(bookingPosts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The group party (the section reports guests by band)

describe('the group party', () => {
  const BANDS = [
    { band: 'adult', rangeLabel: '16+', priceIsk: null },
    { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
    { band: 'infant', rangeLabel: '0-5', priceIsk: 0 },
  ];

  it('counts by band become one band per guest seat: kept in place, freed seats filled, new seats at the end', () => {
    const order = ['adult', 'child', 'infant'];
    expect(guestBandsFromCounts([], { adult: 1, child: 1 }, order)).toEqual(['adult', 'child']);
    // Same size, another age: the seat that lost its band takes the new one.
    expect(guestBandsFromCounts(['adult', 'adult'], { adult: 1, child: 1 }, order)).toEqual(['adult', 'child']);
    expect(guestBandsFromCounts(['child', 'adult'], { adult: 2 }, order)).toEqual(['adult', 'adult']);
    // A choice stays with its person when another guest leaves.
    expect(guestBandsFromCounts(['child', 'adult', 'infant'], { child: 1, infant: 1 }, order)).toEqual(['child', 'infant']);
    expect(guestBandsFromCounts(['child'], { child: 1, adult: 2 }, order)).toEqual(['child', 'adult', 'adult']);
    // A band the venue's list does not name still counts, after the known ones.
    expect(guestBandsFromCounts([], { senior: 1, adult: 1 }, order)).toEqual(['adult', 'senior']);
    // Nonsense counts are none; ten people at most.
    expect(guestBandsFromCounts(['adult'], { adult: -2, child: Number.NaN, infant: 0.5 }, order)).toEqual([]);
    expect(guestBandsFromCounts([], { adult: 20 }, order)).toHaveLength(9);
  });

  function partyWorld(): void {
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START], { provider: 'bokun', ageBands: BANDS });
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
  }

  async function onConfirmStep(): Promise<TestSession> {
    partyWorld();
    const session = testSession({ activity: BOKUN, initialDay: VENUE_DAY });
    await session.store.getState().loadTimetable();
    session.store.getState().selectSlot(session.store.getState().availableSlots[0]);
    session.store.setState({ currentStep: 2 });
    await session.store.getState().loadPreview();
    return session;
  }

  it('a child guest is priced and booked as a child: the preview and the create carry every band', async () => {
    const { store } = await onConfirmStep();
    await store.getState().changeGuests({ adult: 1, child: 1 });
    expect(store.getState().participants).toBe(3);
    expect(store.getState().guestAgeBands).toEqual(['adult', 'child']);
    // The party re-read the timetable for three, kept the time and re-priced it.
    expect(requests('/availability').at(-1)!.query.participants).toBe('3');
    expect(store.getState().selectedSlot?.startTime).toEqual(START);
    const preview = requests('/booking-preview').at(-1)!;
    expect(preview.query).toMatchObject({ participants: '3', guestAgeBands: 'adult,child' });

    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0])).toMatchObject({ participants: 3, guestAgeBands: ['adult', 'child'] });
  });

  it('the same party size with another age re-prices in place, with the bands, and drops the offer and the rung', async () => {
    const { store } = await onConfirmStep();
    await store.getState().changeGuests({ adult: 2 });
    const availabilityReads = requests('/availability').length;
    const previewReads = requests('/booking-preview').length;
    store.setState({ pendingOffer: { kind: 'surcharge', amountIsk: 9_000 }, offerWasReoffered: true, visitChoice: 'keep_visit' });

    await store.getState().changeGuests({ adult: 1, child: 1 });

    expect(store.getState().participants).toBe(3);
    expect(store.getState().guestAgeBands).toEqual(['adult', 'child']);
    expect(store.getState().pendingOffer).toBeNull();
    expect(store.getState().offerWasReoffered).toBe(false);
    expect(store.getState().visitChoice).toBeNull();
    // No timetable read (capacity is the same), one re-price with the new ages.
    expect(requests('/availability')).toHaveLength(availabilityReads);
    expect(requests('/booking-preview')).toHaveLength(previewReads + 1);
    expect(requests('/booking-preview').at(-1)!.query.guestAgeBands).toBe('adult,child');

    // The same answer again changes nothing.
    await store.getState().changeGuests({ child: 1, adult: 1 });
    expect(requests('/booking-preview')).toHaveLength(previewReads + 1);

    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0]).guestAgeBands).toEqual(['adult', 'child']);
  });

  it('all-adult guests send no bands, and nothing changes while a booking is in flight', async () => {
    const { store } = await onConfirmStep();
    await store.getState().changeGuests({ adult: 1 });
    expect(store.getState().participants).toBe(2);
    expect(requests('/booking-preview').at(-1)!.query).not.toHaveProperty('guestAgeBands');

    store.setState({ isBooking: true });
    await store.getState().changeGuests({ adult: 1, child: 2 });
    expect(store.getState().participants).toBe(2);
    expect(store.getState().guestAgeBands).toEqual(['adult']);
  });
});

// ---------------------------------------------------------------------------
// The charge Confirm names

describe('the amount Confirm will charge', () => {
  it('a surcharge or a top-up names its amount; an included or refused class names none', async () => {
    for (const [preview, amount] of [
      [SURCHARGE_PREVIEW, 1_990],
      [{ kind: 'topup', topupReason: 'boutique_overflow', priceIsk: 2_490, remainingMonthly: 0, isLastBeforeTopUp: false }, 2_490],
      [FREE_PREVIEW, null],
    ] as const) {
      classWorld(preview);
      const { store } = testSession();
      await store.getState().prepare(ablerOccurrence());
      expect(confirmChargeIsk(store.getState())).toBe(amount);
    }
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      return Reply.problem(403, 'no_active_plan_or_pass');
    });
    const refused = testSession();
    await refused.store.getState().prepare(ablerOccurrence());
    expect(confirmChargeIsk(refused.store.getState())).toBeNull();
  });

  it('a class shows the server rung with no picker, and never sends a rung', async () => {
    classWorld(RUNG_CHOICE_PREVIEW);
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(requests('/booking-preview')[0].query.visitChoice).toBeUndefined();
    expect(visitChoiceOptions(store.getState())).toHaveLength(0);
    expect(confirmChargeIsk(store.getState())).toBe(1_500);
    store.setState({ visitChoice: 'keep_visit' });
    expect(confirmChargeIsk(store.getState())).toBe(1_500);
    await store.getState().loadPreview();
    expect(requests('/booking-preview').at(-1)?.query.visitChoice).toBeUndefined();
  });

  it('a slot follows the picked rung', async () => {
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(RUNG_CHOICE_PREVIEW);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700)));
    expect(confirmChargeIsk(store.getState())).toBe(1_500);
    store.setState({ visitChoice: 'keep_visit' });
    expect(confirmChargeIsk(store.getState())).toBe(4_900);
  });

  it('a failed disclosure names no amount (the consent names it)', async () => {
    respond(() => Reply.problem(500, 'internal_error'));
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700)));
    expect(store.getState().occurrenceStatus).toBe('ready');
    expect(store.getState().preview).toBeNull();
    expect(confirmChargeIsk(store.getState())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The full flow's entry and timetable

describe('the full flow', () => {
  it("See other times opens on the session's timetable, spinner first, and Back reaches the date picker", async () => {
    const { store } = testSession({ activity: ABLER, initialDay: VENUE_DAY });
    expect(store.getState().currentStep).toBe(1);
    expect(store.getState().selectedDay).toBe(VENUE_DAY);
    expect(store.getState().isLoading).toBe(true);

    respond((request) =>
      request.path.endsWith('/classes')
        ? classesReply([klass(4242, START), klass(4243, plus(START, 7200))])
        : Reply.problem(404, 'not_found'),
    );
    await store.getState().loadTimetable();
    // Abler: the two weeks from the day.
    expect(requests('/classes')[0].query).toEqual({ start: VENUE_DAY, end: '2030-03-28' });
    expect(store.getState().classes.map((c) => c.eventId)).toEqual([4242, 4243]);
    expect(store.getState().isLoading).toBe(false);

    store.getState().previousStep();
    expect(store.getState().currentStep).toBe(0);
  });

  it('a day in the past opens on today; every other entry point opens on the date picker', () => {
    const now = new Date('2030-03-14T23:30:00Z');
    const past = testSession({ activity: ABLER, initialDay: '2030-03-10', deps: { now: () => now } });
    expect(past.store.getState().currentStep).toBe(1);
    expect(past.store.getState().selectedDay).toBe('2030-03-14');

    const plain = testSession({ activity: ABLER, deps: { now: () => now } });
    expect(plain.store.getState().currentStep).toBe(0);
    expect(plain.store.getState().isLoading).toBe(false);
    expect(plain.store.getState().selectedDay).toBe('2030-03-14');
  });

  it('the opening day loads on appear once, and only when opened on a day', () => {
    expect(loadsInitialDayOnAppear(VENUE_DAY, 1, false)).toBe(true);
    expect(loadsInitialDayOnAppear(VENUE_DAY, 1, true)).toBe(false);
    expect(loadsInitialDayOnAppear(null, 0, false)).toBe(false);
    expect(loadsInitialDayOnAppear(VENUE_DAY, 0, false)).toBe(false);
    expect(loadsInitialDayOnAppear(VENUE_DAY, 2, false)).toBe(false);
  });

  it('the date picker never goes before today, and a tap only selects', () => {
    const now = new Date('2030-03-14T08:00:00Z');
    const { store } = testSession({ activity: FIRST_PARTY, deps: { now: () => now } });
    store.getState().selectDay('2030-03-01');
    expect(store.getState().selectedDay).toBe('2030-03-14');
    store.getState().selectDay('2030-03-20');
    expect(store.getState().selectedDay).toBe('2030-03-20');
    expect(store.getState().currentStep).toBe(0);
  });

  it('a slot that started while the answer was in flight is not shown', async () => {
    const now = new Date('2030-03-14T10:00:30Z');
    respond((request) =>
      request.path.endsWith('/availability') ? slotsReply([START, plus(START, 3600)]) : Reply.problem(404, 'not_found'),
    );
    const { store } = testSession({ activity: FIRST_PARTY, initialDay: VENUE_DAY, deps: { now: () => now } });
    await store.getState().loadTimetable();
    expect(store.getState().availableSlots.map((s) => s.startTime)).toEqual([plus(START, 3600)]);
  });

  it('changing the selection drops the key, the refusal, the offer and the rung; the same slot keeps them', () => {
    const { store } = testSession({ activity: FIRST_PARTY });
    const slot = (start: Date) =>
      makeSlot({ activityId: ACTIVITY_ID, startTime: start, endTime: plus(start, 2700), isAvailable: true, remainingCapacity: null, instructor: null, title: null });
    store.getState().selectSlot(slot(START));
    store.setState({
      idempotencyKey: 'k-1',
      gateRefusal: { messageKey: 'refusal.slot_full', cta: 'chooseAnotherTime' },
      offeredChargeIsk: 1_990,
      offerWasReoffered: true,
      visitChoice: 'keep_visit',
    });
    store.getState().selectSlot(slot(START));
    expect(store.getState().idempotencyKey).toBe('k-1');
    store.getState().selectSlot(slot(plus(START, 3600)));
    const s = store.getState();
    expect([s.idempotencyKey, s.gateRefusal, s.offeredChargeIsk, s.offerWasReoffered, s.visitChoice]).toEqual([
      null,
      null,
      null,
      false,
      null,
    ]);
  });

  it('a timetable that cannot load reads in the app words, never the server detail or "HTTP 504"', async () => {
    const classes = testSession({ activity: ABLER });
    respond(() => Reply.problem(400, 'classes-range-too-wide'));
    await classes.store.getState().loadTimetable();
    expect(classes.store.getState().error).toBe(en('error.refusal_fallback'));

    const slots = testSession({ activity: FIRST_PARTY });
    respond(() => Reply.problem(501, 'availability_not_implemented_for_provider'));
    await slots.store.getState().loadTimetable();
    expect(slots.store.getState().error).toBe(en('error.server'));

    respond(() => Reply.raw(504, '<html><body>504 Gateway Timeout</body></html>'));
    await slots.store.getState().loadTimetable();
    expect(slots.store.getState().error).toBe(en('error.server'));
    expect(slots.store.getState().error).not.toContain('504');
  });

  it('the venue day is asked for even when the phone is on another zone', async () => {
    // 23:30 in New York on 13 March is 03:30 on 14 March in Reykjavík.
    const now = new Date('2030-03-14T03:30:00Z');
    respond(() => slotsReply([]));
    const { store } = testSession({ activity: FIRST_PARTY, deps: { now: () => now } });
    store.getState().nextStep();
    await store.getState().loadTimetable();
    expect(requests('/availability')[0].query.start).toBe('2030-03-14');
  });
});

// ---------------------------------------------------------------------------
// Refusals (2.5.5)

describe('refusals', () => {
  it('a trial venue refusal at the preview hides Confirm with its step; a paused membership is rechecked after', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      return Reply.problem(403, 'trial_venue_not_included');
    });
    const trial = testSession();
    await trial.store.getState().prepare(ablerOccurrence());
    expect(trial.store.getState().gateRefusal).toEqual({ messageKey: 'refusal.trial_venue', cta: 'seePlans' });
    expect(canConfirmOccurrence(trial.store.getState())).toBe(false);

    let resumed = false;
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      return resumed ? Reply.ok(FREE_PREVIEW) : Reply.problem(409, 'subscription_paused');
    });
    const paused = testSession();
    await paused.store.getState().prepare(ablerOccurrence());
    expect(paused.store.getState().gateRefusal).toEqual({ messageKey: 'refusal.paused', cta: 'resumeMembership' });
    resumed = true;
    await paused.store.getState().recheckAfterPlans();
    expect(paused.store.getState().gateRefusal).toBeNull();
    expect(canConfirmOccurrence(paused.store.getState())).toBe(true);
  });

  it.each([
    ['429', Reply.problem(429, 'rate_limited')],
    ['500', Reply.problem(500, 'internal_error')],
    ['400', Reply.problem(400, 'invalid-booking-preview')],
    ['unknown 409', Reply.problem(409, 'brand_new_refusal')],
    ['no answer', Reply.fail()],
  ])('a %s at the preview keeps Confirm', async (_label, reply) => {
    respond((request) => (request.path.endsWith('/classes') ? classesReply([klass(4242, START)]) : reply));
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(store.getState().gateRefusal).toBeNull();
    expect(canConfirmOccurrence(store.getState())).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it('a not-replayable attempt starts a new key', async () => {
    let posts = 0;
    classWorld(FREE_PREVIEW, () => {
      posts += 1;
      return posts === 1 ? Reply.problem(409, 'booking_not_replayable') : Reply.ok(CONFIRMED);
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().gateRefusal).toEqual({ messageKey: 'refusal.replay', cta: 'chooseAnotherTime' });
    await store.getState().retryAfterRefusal();
    const all = bookingPosts();
    expect(all).toHaveLength(2);
    expect(all[0].headers['idempotency-key']).not.toBe(all[1].headers['idempotency-key']);
    expect(store.getState().bookingComplete).toBe(true);
  });

  it('a moved price drops the rung and the offer and re-reads once, with no loop', async () => {
    respond((request) => {
      if (request.path.endsWith('/booking-preview')) return Reply.ok(RUNG_CHOICE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.problem(409, 'visit_choice_unavailable');
      return Reply.problem(500, 'internal_error');
    });
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700)));
    await store.getState().changeVisitChoice('keep_visit');
    expect(requests('/booking-preview').at(-1)?.query.visitChoice).toBe('keep_visit');
    const before = requests('/booking-preview').length;

    await store.getState().confirmBooking();

    const s = store.getState();
    expect(s.error).toBe(en('refusal.price_changed'));
    expect([s.visitChoice, s.pendingOffer, s.showChargeConsent, s.gateRefusal]).toEqual([null, null, false, null]);
    expect(requests('/booking-preview')).toHaveLength(before + 1);
    expect(requests('/booking-preview').at(-1)?.query.visitChoice).toBeUndefined();
    expect(bookingPosts()).toHaveLength(1);
  });

  it('a payment outage is an alert with Try again that keeps Confirm; the step goes with the alert', async () => {
    classWorld(FREE_PREVIEW, () =>
      Reply.problem(502, 'kling_payment_unavailable', { detail: 'Kling payment service is temporarily unavailable.' }),
    );
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().error).toBe(en('refusal.payments_down'));
    expect(store.getState().errorCta).toBe('tryAgain');
    expect(store.getState().gateRefusal).toBeNull();
    expect(canConfirmOccurrence(store.getState())).toBe(true);
    store.getState().dismissError();
    expect(store.getState().errorCta).toBeNull();
  });

  it('an unhandled server error is an alert with Try again, the same attempt replayed', async () => {
    classWorld(FREE_PREVIEW, () => Reply.problem(500, 'internal_error', { detail: 'An unexpected server error occurred.' }));
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().error).toBe(en('error.server'));
    expect(store.getState().errorCta).toBe('tryAgain');
    await store.getState().retryAfterRefusal();
    const all = bookingPosts();
    expect(all).toHaveLength(2);
    expect(all[0].headers['idempotency-key']).toBe(all[1].headers['idempotency-key']);
  });

  it("an unknown create refusal is the fallback, never the server's words", async () => {
    classWorld(FREE_PREVIEW, () => Reply.problem(409, 'brand_new_refusal'));
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().error).toBe(en('error.refusal_fallback'));
    expect(store.getState().error).not.toContain('Server detail');
    expect(store.getState().gateRefusal).toBeNull();
  });

  it.each([
    [409, 'booking_charge_unresolved', 'refusal.payment_unresolved', 'contactSupport'],
    [502, 'provider_booking_uncertain', 'refusal.pending_confirm', 'myBookings'],
    [409, 'activity_resource_conflict', 'refusal.slot_full', 'chooseAnotherTime'],
  ])('a %s %s goes inline with its step and hides Confirm', async (status, code, messageKey, cta) => {
    classWorld(FREE_PREVIEW, () => Reply.problem(status, code));
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await store.getState().confirmBooking();
    expect(store.getState().gateRefusal).toEqual({ messageKey, cta });
    expect(store.getState().error).toBeNull();
    expect(canConfirmOccurrence(store.getState())).toBe(false);
  });

  /** A first-party slot with a top-up refused at the consented re-POST. */
  async function declineFlow(code: string, status = 402) {
    let posts = 0;
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) {
        return Reply.ok({ kind: 'topup', priceIsk: 2_490, remainingMonthly: 0, isLastBeforeTopUp: false });
      }
      if (request.method === 'POST' && request.path === '/bookings') {
        posts += 1;
        if (posts === 1 || posts === 3) return consent(2_490, 'topup');
        if (posts === 2) return Reply.problem(status, code, { detail: 'Payment could not be authorized for this booking.' });
        return Reply.ok(CONFIRMED);
      }
      return Reply.problem(404, 'not_found');
    });
    const session = testSession();
    await session.store.getState().prepare(slotOccurrence(plus(START, 2700)));
    await session.store.getState().confirmBooking();
    await session.store.getState().acceptCharge();
    return session;
  }

  it('a declined card is a new attempt under a new key, with the consent asked again', async () => {
    const { store } = await declineFlow('topup_charge_failed');
    expect(store.getState().error).toBe(en('refusal.payment_failed'));
    expect(store.getState().errorCta).toBe('tryAgain');
    store.getState().dismissError();
    await store.getState().retryAfterRefusal();
    expect(store.getState().showChargeConsent).toBe(true);
    await store.getState().acceptCharge();
    expect(store.getState().bookingComplete).toBe(true);
    const keys = bookingPosts().map((post) => post.headers['idempotency-key']);
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[2]);
    expect(keys[2]).toBe(keys[3]);
  });

  it('every definitive decline ends the attempt; an uncertain capture keeps its key', async () => {
    expect([...DECLINED_ATTEMPT_CODES].sort()).toEqual(
      [
        'surcharge_charge_failed',
        'topup_charge_failed',
        'charge_capture_failed',
        'card_declined',
        'charge_declined',
        'charge_rejected',
        'payment_intent_failed',
      ].sort(),
    );
    for (const uncertain of ['kling_capture_failed', 'booking_charge_unresolved', 'booking_payment_unresolved', 'provider_booking_uncertain', 'booking_not_replayable']) {
      expect(DECLINED_ATTEMPT_CODES.has(uncertain)).toBe(false);
    }
    for (const code of [...DECLINED_ATTEMPT_CODES].sort()) {
      api.reset();
      const { store } = await declineFlow(code);
      expect(store.getState().error).toBe(en('refusal.payment_failed'));
      expect(store.getState().errorCta).toBe('tryAgain');
      store.getState().dismissError();
      await store.getState().retryAfterRefusal();
      const keys = bookingPosts().map((post) => post.headers['idempotency-key']);
      expect(keys).toHaveLength(3);
      expect(keys[1]).not.toBe(keys[2]);
    }

    api.reset();
    const { store } = await declineFlow('kling_capture_failed', 502);
    expect(store.getState().error).toBe(en('refusal.capture_unknown'));
    expect(store.getState().errorCta).toBeNull();
    store.getState().dismissError();
    await store.getState().confirmBooking();
    const keys = bookingPosts().map((post) => post.headers['idempotency-key']);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[2]);
  });

  it.each([502, 503, 504])('a gateway %s page on the create is an unknown outcome, Check again under the same key', async (status) => {
    let posts = 0;
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') {
        posts += 1;
        return posts === 1 ? Reply.raw(status, `<html><body>${status} An error occurred</body></html>`) : Reply.ok(CONFIRMED);
      }
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(slotOccurrence(plus(START, 2700)));
    await store.getState().confirmBooking();
    expect(store.getState().bookingOutcomeUnknown).toBe(true);
    expect(store.getState().error).toBeNull();
    expect(store.getState().bookingComplete).toBe(false);
    await store.getState().checkBookingAgain();
    expect(store.getState().bookingComplete).toBe(true);
    const all = bookingPosts();
    expect(all[0].headers['idempotency-key']).toBe(all[1].headers['idempotency-key']);
  });

  it('a crash page on the create is our failure with Try again; an odd status is the fallback', async () => {
    let posts = 0;
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') {
        posts += 1;
        return posts === 1 ? Reply.raw(500, '<html><body>Internal Server Error</body></html>') : Reply.ok(CONFIRMED);
      }
      return Reply.problem(404, 'not_found');
    });
    const crash = testSession();
    await crash.store.getState().prepare(slotOccurrence(plus(START, 2700)));
    await crash.store.getState().confirmBooking();
    expect(crash.store.getState().error).toBe(en('error.server'));
    expect(crash.store.getState().errorCta).toBe('tryAgain');
    expect(crash.store.getState().bookingOutcomeUnknown).toBe(false);
    crash.store.getState().dismissError();
    await crash.store.getState().retryAfterRefusal();
    expect(crash.store.getState().bookingComplete).toBe(true);
    expect(bookingPosts()[0].headers['idempotency-key']).toBe(bookingPosts()[1].headers['idempotency-key']);

    api.reset();
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      return Reply.raw(413, '<html><body>Payload Too Large</body></html>');
    });
    const odd = testSession();
    await odd.store.getState().prepare(slotOccurrence(plus(START, 2700)));
    await odd.store.getState().confirmBooking();
    expect(odd.store.getState().error).toBe(en('error.refusal_fallback'));
    expect(odd.store.getState().errorCta).toBeNull();
    expect(odd.store.getState().bookingOutcomeUnknown).toBe(false);
  });

  it('a double tap sends one create', async () => {
    classWorld(FREE_PREVIEW);
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    await Promise.all([store.getState().confirmBooking(), store.getState().confirmBooking()]);
    expect(bookingPosts()).toHaveLength(1);
  });

  it('Choose another time returns to the timetable and lets the time go; Change guests keeps it', async () => {
    const { store } = testSession({ activity: FIRST_PARTY });
    const slot = makeSlot({ activityId: ACTIVITY_ID, startTime: START, endTime: plus(START, 2700), isAvailable: true, remainingCapacity: 4, instructor: null, title: null });
    store.getState().selectSlot(slot);
    store.setState({ currentStep: 2, gateRefusal: { messageKey: 'refusal.slot_full', cta: 'chooseAnotherTime' } });
    store.getState().returnToTimetable(true);
    expect(store.getState().currentStep).toBe(1);
    expect(store.getState().gateRefusal).toBeNull();
    expect(store.getState().selectedSlot?.id).toBe(slot.id);
    store.setState({ currentStep: 2 });
    store.getState().returnToTimetable(false);
    expect(store.getState().selectedSlot).toBeNull();
  });
});
