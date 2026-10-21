/**
 * The party and the rung in the booking session, against the stub server
 * (iOS BookingViewModel `changeParticipants`, `changeGuestAgeBand`,
 * `changeVisitChoice`, `guestAgeBandsForRequest`, `buildInput`, and the
 * BookingMoneyPathTests / ClassBookingSheetTests cases that touch them).
 * They assert what the phone ASKS and SENDS for a party and a rung: the
 * timetable read for everyone, the time kept only while it seats the party,
 * one band per guest and only when someone is not an adult, and the rung on
 * every body that prices the booking, never on a class.
 */
import { Reply, type StubReply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import {
  buildInput,
  disclosedPriceIsk,
  groupBookable,
  guestAgeBandsForRequest,
  hasSelection,
  selectedVisitOption,
  showsAgeBands,
  visitChoiceOptions,
} from '../../bookingSession';
import {
  ABLER,
  ablerOccurrence,
  BOKUN,
  bodyOf,
  bookingPosts,
  classesReply,
  CONFIRMED,
  consent,
  FIRST_PARTY,
  flush,
  FREE_PREVIEW,
  iso,
  klass,
  plus,
  requests,
  respond,
  RUNG_CHOICE_PREVIEW,
  sessionPosts,
  START,
  testSession,
  VENUE_DAY,
  type TestSession,
} from '../../__tests__/bookingHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  setCurrentLanguage('en');
});

const BANDS = [
  { band: 'adult', rangeLabel: '16+', priceIsk: null },
  { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
  { band: 'infant', rangeLabel: '0-5', priceIsk: 0 },
];

const SECOND = plus(START, 3600);

/**
 * A Bókun day: two times, each with the spots `capacity` gives for the
 * party asked about, the venue's bands, and the given preview and create.
 */
function lagoonDay(
  options: {
    capacity?: (participants: number, start: Date) => number | null;
    ageBands?: unknown[];
    preview?: (request: StubRequest) => StubReply;
    create?: (request: StubRequest) => StubReply;
    session?: (request: StubRequest) => StubReply;
  } = {},
): void {
  respond((request) => {
    if (request.path.endsWith('/availability')) {
      const participants = Number(request.query.participants ?? '1');
      return Reply.ok({
        activityId: BOKUN.id,
        provider: 'bokun',
        slots: [START, SECOND].map((start) => ({
          startsAt: iso(start),
          endsAt: iso(plus(start, 7200)),
          available: true,
          remainingCapacity: options.capacity ? options.capacity(participants, start) : 8,
        })),
        ageBands: options.ageBands ?? BANDS,
        fetchedAt: iso(new Date()),
      });
    }
    if (request.path.endsWith('/booking-preview')) return options.preview?.(request) ?? Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      return options.session?.(request) ?? Reply.problem(404, 'not_found');
    }
    if (request.method === 'POST' && request.path === '/bookings') return options.create?.(request) ?? Reply.ok(CONFIRMED);
    return Reply.problem(404, 'not_found');
  });
}

/** The full flow on a Bókun day's timetable, the first time picked. */
async function onTimetable(): Promise<TestSession> {
  const session = testSession({ activity: BOKUN, initialDay: VENUE_DAY });
  session.store.getState().resetParty();
  await session.store.getState().loadTimetable();
  session.store.getState().selectSlot(session.store.getState().availableSlots[0]);
  return session;
}

/** The same, moved on to the confirm step with its disclosure read. */
async function onConfirmStep(): Promise<TestSession> {
  const session = await onTimetable();
  session.store.setState({ currentStep: 2 });
  await session.store.getState().loadPreview();
  return session;
}

// ---------------------------------------------------------------------------

describe('the party size', () => {
  it('only a Bókun slot activity takes a party: never a first-party slot or a class', () => {
    expect(groupBookable({ activity: BOKUN })).toBe(true);
    expect(groupBookable({ activity: FIRST_PARTY })).toBe(false);
    expect(groupBookable({ activity: ABLER })).toBe(false);
    expect(groupBookable({ activity: null })).toBe(false);
  });

  it('runs from one to ten, the guest list always one shorter, and each step re-reads the day for everyone', async () => {
    lagoonDay();
    const { store } = await onTimetable();
    await store.getState().changeParticipants(0);
    expect(store.getState().participants).toBe(1);
    expect(requests('/availability')).toHaveLength(1);

    for (let size = 2; size <= 10; size += 1) {
      await store.getState().changeParticipants(size);
      expect(store.getState().guestAgeBands).toHaveLength(size - 1);
      expect(requests('/availability').at(-1)!.query.participants).toBe(`${size}`);
    }
    const reads = requests('/availability').length;
    await store.getState().changeParticipants(11);
    expect(store.getState().participants).toBe(10);
    expect(requests('/availability')).toHaveLength(reads);
    expect(requests('/availability').at(-1)!.query).toEqual({ start: VENUE_DAY, end: VENUE_DAY, participants: '10' });
  });

  it('a new guest is an adult at the end; a smaller party drops the last guests, so a picked age stays with its person', async () => {
    lagoonDay();
    const { store } = await onTimetable();
    await store.getState().changeParticipants(3);
    expect(store.getState().guestAgeBands).toEqual(['adult', 'adult']);
    await store.getState().changeGuestAgeBand(0, 'child');
    await store.getState().changeParticipants(4);
    expect(store.getState().guestAgeBands).toEqual(['child', 'adult', 'adult']);
    await store.getState().changeParticipants(2);
    expect(store.getState().guestAgeBands).toEqual(['child']);
  });

  it('keeps the picked time while it seats the whole party, and lets it go when it cannot', async () => {
    // Four spots at 10:00 whatever the party; plenty at 11:00.
    lagoonDay({ capacity: (_party, start) => (start.getTime() === START.getTime() ? 4 : 20) });
    const { store } = await onTimetable();
    const picked = store.getState().selectedSlot!;
    expect(picked.startTime).toEqual(START);

    await store.getState().changeParticipants(4);
    expect(store.getState().selectedSlot?.startTime).toEqual(START);
    // The refreshed slot (its new spot count), not the old copy.
    expect(store.getState().selectedSlot?.remainingCapacity).toBe(4);

    await store.getState().changeParticipants(5);
    expect(store.getState().selectedSlot).toBeNull();
    expect(store.getState().availableSlots.map((slot) => slot.startTime)).toEqual([START, SECOND]);
  });

  describe('two changes faster than the server answers (a quick double tap)', () => {
    /**
     * A Bókun day whose reads wait, once `holding`, until released by the
     * order they were asked in: 10:00 with `spots` places, 11:00 with plenty.
     */
    function heldDay(spots: number) {
      const waiting: (() => void)[] = [];
      const day = {
        holding: false,
        release: (index: number) => waiting[index]!(),
        waiting: () => waiting.length,
      };
      respond((request) => {
        if (!request.path.endsWith('/availability')) return Reply.problem(404, 'not_found');
        const reply = Reply.ok({
          activityId: BOKUN.id,
          provider: 'bokun',
          slots: [START, SECOND].map((start) => ({
            startsAt: iso(start),
            endsAt: iso(plus(start, 7200)),
            available: true,
            remainingCapacity: start.getTime() === START.getTime() ? spots : 20,
          })),
          ageBands: BANDS,
          fetchedAt: iso(new Date()),
        });
        if (!day.holding) return reply;
        return new Promise<StubReply>((resolve) => waiting.push(() => resolve(reply)));
      });
      return day;
    }

    /** Two plus taps from the member alone, answered in `order`. */
    async function doubleTap(spots: number, order: readonly number[]): Promise<TestSession> {
      const day = heldDay(spots);
      const session = await onTimetable();
      expect(session.store.getState().selectedSlot?.startTime).toEqual(START);
      day.holding = true;
      const first = session.store.getState().changeGuests({ adult: 1 });
      const second = session.store.getState().changeGuests({ adult: 2 });
      await flush();
      expect(day.waiting()).toBe(2);
      expect(requests('/availability').slice(-2).map((request) => request.query.participants)).toEqual(['2', '3']);
      for (const index of order) {
        day.release(index);
        await flush();
      }
      await Promise.all([first, second]);
      expect(session.store.getState().participants).toBe(3);
      expect(session.store.getState().isLoading).toBe(false);
      return session;
    }

    it.each([
      ['in the order asked', [0, 1]],
      ['the other way round', [1, 0]],
    ])('a time with two places is let go for three people, answered %s', async (_, order) => {
      const { store } = await doubleTap(2, order);
      expect(store.getState().selectedSlot).toBeNull();
      expect(hasSelection(store.getState())).toBe(false);
    });

    it.each([
      ['in the order asked', [0, 1]],
      ['the other way round', [1, 0]],
    ])('a time with eight places is kept for three people, answered %s', async (_, order) => {
      const { store } = await doubleTap(8, order);
      expect(store.getState().selectedSlot?.startTime).toEqual(START);
      expect(store.getState().selectedSlot?.remainingCapacity).toBe(8);
    });

    it('another day read while a change is out lets the old day\'s time go', async () => {
      const day = heldDay(8);
      const { store } = await onTimetable();
      day.holding = true;
      const change = store.getState().changeGuests({ adult: 1 });
      // The member goes back and opens the next day before the answer.
      store.getState().selectDay('2030-03-15');
      const reread = store.getState().loadTimetable();
      const after = store.getState().changeGuests({ adult: 2 });
      await flush();
      expect(day.waiting()).toBe(3);
      for (const index of [0, 1, 2]) {
        day.release(index);
        await flush();
      }
      await Promise.all([change, reread, after]);
      expect(requests('/availability').at(-1)!.query).toMatchObject({ start: '2030-03-15', participants: '3' });
      expect(store.getState().participants).toBe(3);
      expect(store.getState().selectedSlot).toBeNull();
    });
  });

  it('a time the provider stopped offering for the party is let go; one with no known spot count is kept', async () => {
    let unavailable = false;
    respond((request) => {
      if (request.path.endsWith('/availability')) {
        return Reply.ok({
          activityId: BOKUN.id,
          provider: 'bokun',
          slots: [{ startsAt: iso(START), endsAt: iso(plus(START, 7200)), available: !unavailable, remainingCapacity: null }],
          ageBands: [],
          fetchedAt: iso(new Date()),
        });
      }
      return Reply.problem(404, 'not_found');
    });
    const { store } = await onTimetable();
    await store.getState().changeParticipants(6);
    expect(store.getState().selectedSlot?.startTime).toEqual(START);
    unavailable = true;
    await store.getState().changeParticipants(7);
    expect(store.getState().selectedSlot).toBeNull();
  });

  it('on the confirm step a kept time is priced again for the new party, with the offer and the rung dropped', async () => {
    lagoonDay({ preview: () => Reply.ok(RUNG_CHOICE_PREVIEW) });
    const { store } = await onConfirmStep();
    await store.getState().changeVisitChoice('keep_visit');
    store.setState({ pendingOffer: { kind: 'surcharge', amountIsk: 4_900 }, offerWasReoffered: true });
    const previews = requests('/booking-preview').length;

    await store.getState().changeParticipants(2);

    const s = store.getState();
    expect([s.pendingOffer, s.offerWasReoffered, s.visitChoice]).toEqual([null, false, null]);
    expect(requests('/booking-preview')).toHaveLength(previews + 1);
    const preview = requests('/booking-preview').at(-1)!;
    expect(preview.query.participants).toBe('2');
    expect(preview.query.visitChoice).toBeUndefined();
  });

  it('a fresh flow starts solo, with no bands from the venue before', async () => {
    lagoonDay();
    const { store } = await onTimetable();
    await store.getState().changeParticipants(3);
    expect(store.getState().offeredAgeBands).toHaveLength(3);
    store.getState().resetParty();
    expect([store.getState().participants, store.getState().guestAgeBands, store.getState().offeredAgeBands]).toEqual([1, [], []]);
    expect(showsAgeBands(store.getState())).toBe(false);
  });
});

describe('the guest age bands', () => {
  it('ride only when the venue sells more than one band, someone else comes, and a guest is not an adult', async () => {
    lagoonDay();
    const { store } = await onTimetable();
    const bands = () => guestAgeBandsForRequest(store.getState());
    expect(showsAgeBands(store.getState())).toBe(false);
    expect(bands()).toBeNull();

    await store.getState().changeParticipants(3);
    expect(showsAgeBands(store.getState())).toBe(true);
    // Every guest an adult: byte-identical to a request with no bands.
    expect(bands()).toBeNull();
    await store.getState().changeGuestAgeBand(1, 'infant');
    // One per GUEST, in seat order; the member is never in it.
    expect(bands()).toEqual(['adult', 'infant']);
    expect(bands()).toHaveLength(store.getState().participants - 1);

    // A venue that sells adults only never sends a band, whatever the seats say.
    store.setState({ offeredAgeBands: [BANDS[0]] });
    expect(bands()).toBeNull();
  });

  it('an age change re-prices in place: no timetable read, the bands on the preview and the create', async () => {
    lagoonDay();
    const { store } = await onConfirmStep();
    await store.getState().changeParticipants(3);
    const reads = requests('/availability').length;
    await store.getState().changeGuestAgeBand(0, 'child');
    expect(requests('/availability')).toHaveLength(reads);
    expect(requests('/booking-preview').at(-1)!.query).toMatchObject({ participants: '3', guestAgeBands: 'child,adult' });
    // The same band again, or a seat that is not there, asks nothing.
    const previews = requests('/booking-preview').length;
    await store.getState().changeGuestAgeBand(0, 'child');
    await store.getState().changeGuestAgeBand(5, 'child');
    expect(requests('/booking-preview')).toHaveLength(previews);

    await store.getState().confirmBooking();
    expect(bodyOf(bookingPosts()[0])).toMatchObject({ participants: 3, guestAgeBands: ['child', 'adult'] });
  });

  it('a solo booking sends no party at all', async () => {
    lagoonDay();
    const { store } = await onConfirmStep();
    expect(requests('/booking-preview').at(-1)!.query).not.toHaveProperty('participants');
    await store.getState().confirmBooking();
    const body = bodyOf(bookingPosts()[0]);
    expect(body).not.toHaveProperty('participants');
    expect(body).not.toHaveProperty('guestAgeBands');
    expect(body).not.toHaveProperty('visitChoice');
  });
});

describe('a consent re-POST', () => {
  it('keeps the party, the bands, the rung and the key (BookingMoneyPathTests)', async () => {
    let posts = 0;
    lagoonDay({
      preview: () => Reply.ok(RUNG_CHOICE_PREVIEW),
      create: () => {
        posts += 1;
        return posts === 1 ? consent(13_700) : Reply.ok(CONFIRMED);
      },
    });
    const { store } = await onConfirmStep();
    await store.getState().changeParticipants(3);
    await store.getState().changeGuestAgeBand(1, 'child');
    await store.getState().changeVisitChoice('keep_visit');

    await store.getState().confirmBooking();
    expect(store.getState().showChargeConsent).toBe(true);
    await store.getState().acceptCharge();

    const [first, second] = bookingPosts();
    const party = { participants: 3, guestAgeBands: ['adult', 'child'], visitChoice: 'keep_visit' };
    expect(bodyOf(first)).toMatchObject(party);
    expect(bodyOf(second)).toMatchObject({ ...party, acceptCharge: true, acceptedChargeAmountIsk: 13_700 });
    expect(first.headers['idempotency-key']).toBe(second.headers['idempotency-key']);
    expect(store.getState().bookingComplete).toBe(true);
  });
});

describe('the premium rung', () => {
  /** The preview answers for the rung asked, mirroring it at the top level as the server does. */
  function rungPreview(request: StubRequest): StubReply {
    const keep = request.query.visitChoice === 'keep_visit';
    return Reply.ok({
      ...RUNG_CHOICE_PREVIEW,
      surchargeReason: keep ? 'premium_visit_kept' : 'premium_subscriber_visit',
      priceIsk: keep ? 4_900 : 1_500,
      visitChoice: { ...RUNG_CHOICE_PREVIEW.visitChoice, selected: keep ? 'keep_visit' : 'spend_visit' },
    });
  }

  it("picking one re-previews with it; the amount follows the picked rung, never the mirror", async () => {
    lagoonDay({ preview: rungPreview });
    const { store } = await onConfirmStep();
    expect(visitChoiceOptions(store.getState()).map((option) => option.choice)).toEqual(['spend_visit', 'keep_visit']);
    expect(disclosedPriceIsk(store.getState())).toBe(1_500);

    await store.getState().changeVisitChoice('keep_visit');
    expect(requests('/booking-preview').at(-1)!.query.visitChoice).toBe('keep_visit');
    expect(selectedVisitOption(store.getState())?.choice).toBe('keep_visit');
    expect(disclosedPriceIsk(store.getState())).toBe(4_900);

    // Picking the rung already picked asks nothing.
    const previews = requests('/booking-preview').length;
    await store.getState().changeVisitChoice('keep_visit');
    expect(requests('/booking-preview')).toHaveLength(previews);

    // Even before the re-read lands, the amount is the picked rung's.
    store.setState({ preview: { ...store.getState().preview!, priceIsk: 1_500 } });
    expect(disclosedPriceIsk(store.getState())).toBe(4_900);
  });

  it('rides on the create and on the payment session, under one key', async () => {
    lagoonDay({
      preview: rungPreview,
      create: (request) => (bodyOf(request).acceptCharge === true ? Reply.problem(402, 'no_payment_method_on_file') : consent(4_900)),
      session: () => Reply.problem(503, 'kling_payment_unavailable'),
    });
    const { store } = await onConfirmStep();
    await store.getState().changeVisitChoice('keep_visit');
    await store.getState().confirmBooking();
    await store.getState().acceptCharge();

    expect(bodyOf(bookingPosts()[0]).visitChoice).toBe('keep_visit');
    expect(bodyOf(sessionPosts()[0])).toMatchObject({ visitChoice: 'keep_visit', acceptedChargeAmountIsk: 4_900 });
    expect(sessionPosts()[0].headers['idempotency-key']).toBe(bookingPosts()[0].headers['idempotency-key']);
  });

  it('is dropped with a new time, so a rung picked for one time never rides on another', async () => {
    lagoonDay({ preview: rungPreview });
    const { store } = await onConfirmStep();
    await store.getState().changeVisitChoice('keep_visit');
    store.getState().selectSlot(store.getState().availableSlots[1]);
    expect(store.getState().visitChoice).toBeNull();
    expect(buildInput(store.getState())).toMatchObject({ kind: 'slot', visitChoice: null });
  });

  it('a class never offers or sends one, whatever is left over (ClassBookingSheetTests)', async () => {
    respond((request) => {
      if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(RUNG_CHOICE_PREVIEW);
      if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
      return Reply.problem(404, 'not_found');
    });
    const { store } = testSession();
    await store.getState().prepare(ablerOccurrence());
    expect(visitChoiceOptions(store.getState())).toEqual([]);
    store.setState({ visitChoice: 'keep_visit' });
    await store.getState().loadPreview();
    await store.getState().confirmBooking();
    expect(requests('/booking-preview').every((request) => request.query.visitChoice === undefined)).toBe(true);
    expect(bodyOf(bookingPosts()[0])).not.toHaveProperty('visitChoice');
    expect(bodyOf(bookingPosts()[0])).toMatchObject({ eventId: 4242 });
  });

  it('a moved price drops the rung and the offer and reads the price once more, with no loop', async () => {
    lagoonDay({ preview: rungPreview, create: () => Reply.problem(409, 'visit_choice_not_applicable') });
    const { store } = await onConfirmStep();
    await store.getState().changeVisitChoice('keep_visit');
    const previews = requests('/booking-preview').length;

    await store.getState().confirmBooking();

    expect(store.getState().visitChoice).toBeNull();
    expect(store.getState().pendingOffer).toBeNull();
    expect(requests('/booking-preview')).toHaveLength(previews + 1);
    expect(requests('/booking-preview').at(-1)!.query.visitChoice).toBeUndefined();
    // The re-read is the server's default rung again.
    expect(selectedVisitOption(store.getState())?.choice).toBe('spend_visit');
    expect(bookingPosts()).toHaveLength(1);
  });
});
