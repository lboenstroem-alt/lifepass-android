/**
 * A Coach plan's class step, booked (iOS ClassBookingSheetTests "Where the
 * session comes from": testACoachPlanClassWithAHandleIsItsOwnSession,
 * testACoachClassMatchesTheFeedRowWithItsTitle,
 * testACoachClassIsNotGuessedBetweenTwoClassesAtTheSameTime,
 * testACoachClassTakesTheVenuesOnlyClassAtThatTime,
 * testACoachSlotWithNoEndTakesItFromTheRecheck and
 * testACoachSlotWithNoEndCannotBeBookedBlind; and CoachViewModel's
 * `classOccurrence(for:)` lookup: the title search first, then at most three
 * unfiltered pages of the class's Reykjavík day, else the venue's page).
 *
 * And the iOS 3.1.0 cases of a chat class card (CoachClassCardsTests "Book
 * opens the existing class sheet on THAT session"): the card's own verdict
 * and "from" price ride into the sheet, a slot is booked by its handle's
 * own times, and a card that said Full or "opens later" is never offered
 * Confirm when the sheet's re-check fails.
 */
import { api, Reply } from '@test/server';

import { decodeClassFeedItem, type ClassFeedItem, type ClassFeedPage, type ClassFeedPageQuery } from '../../../../api/classFeed';
import { stubApiClientPerTest } from '../../../../api/testing';
import { runSignOutCleaners } from '../../../../app/signOut';
import { canConfirmOccurrence } from '../../../booking';
import {
  bookCoachClass,
  coachCardSnapshot,
  coachClassOccurrence,
  COACH_CLASS_LOOKUP_PAGES,
  feedOccurrenceMatching,
  resolveCoachClassOccurrence,
  type CoachPlanClass,
} from '../index';
import { ACTIVITY_ID, FREE_PREVIEW, iso, plus, respond, slotsReply, START, testSession } from './sheetHarness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const VENUE_ID = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

/** A feed row as `GET /classes` sends it. */
function feedItem(
  name: string | null,
  booking: Record<string, unknown>,
  options: { venueSlug?: string; at?: Date } = {},
): ClassFeedItem {
  const startsAt = options.at ?? START;
  return decodeClassFeedItem({
    source: 'abler',
    name,
    startsAt: iso(startsAt),
    endsAt: iso(plus(startsAt, 3600)),
    instructor: 'Sigrún',
    locationText: null,
    attendance: { current: 9, limit: 14 },
    full: false,
    canBook: true,
    canBookReason: null,
    registrationOpensAt: null,
    categorySlugs: ['yoga'],
    surchargeFromIsk: 1_990,
    venue: { id: VENUE_ID, slug: options.venueSlug ?? 'hress', name: 'Hress', coordinates: null },
    booking,
  });
}

const ablerHandle = (eventId: number) => ({ kind: 'class', activityId: ACTIVITY_ID, eventId });

function coachClass(title: string | null, booking: CoachPlanClass['booking'] = null, endsAt: Date | null = plus(START, 3600)): CoachPlanClass {
  return { id: 'plan-class-1', title, startsAt: START, endsAt, venueSlug: 'hress', venueName: 'Hress', booking };
}

function page(classes: ClassFeedItem[], nextCursor: string | null = null): ClassFeedPage {
  return { classes, nextCursor, fetchedAt: new Date() };
}

describe("a plan's own handle", () => {
  it('is its own session: an Abler class labelled by its venue', () => {
    const session: CoachPlanClass = {
      ...coachClass('Spin 45', { kind: 'class', activityId: ACTIVITY_ID, eventId: 77 }, plus(START, 2700)),
    };
    const occurrence = coachClassOccurrence(session);
    expect(occurrence?.handle).toEqual({ kind: 'ablerClass', eventId: 77 });
    expect(occurrence?.activity).toEqual({ id: ACTIVITY_ID, name: 'Hress', provider: 'abler' });
    expect(occurrence?.startsAt).toEqual(START);
    expect(occurrence?.endsAt).toEqual(plus(START, 2700));
    expect(occurrence?.className).toBe('Spin 45');
    expect(occurrence?.venueSlug).toBe('hress');
    expect(occurrence?.id).toBe(`coach-plan-class-1-${Math.trunc(START.getTime() / 1000)}`);
    expect(occurrence?.snapshot).toBeNull();
    expect(occurrence?.surchargeFromIsk).toBeNull();

    expect(coachClassOccurrence({ ...session, booking: null })).toBeNull();
    // An Abler class without its event is no handle.
    expect(coachClassOccurrence({ ...session, booking: { kind: 'class', activityId: ACTIVITY_ID, eventId: null } })).toBeNull();
  });

  it('a slot is labelled by its title (the venue when it has none) and keeps an end only after its start', () => {
    const slot = coachClassOccurrence(coachClass('Hot Yoga', { kind: 'slot', activityId: ACTIVITY_ID, eventId: null }, null));
    expect(slot?.handle).toEqual({ kind: 'slot' });
    expect(slot?.activity).toEqual({ id: ACTIVITY_ID, name: 'Hot Yoga', provider: 'internal' });
    expect(slot?.endsAt).toBeNull();
    expect(coachClassOccurrence(coachClass(null, { kind: 'slot', activityId: ACTIVITY_ID, eventId: null }))?.activity.name).toBe('Hress');
    expect(coachClassOccurrence(coachClass('X', { kind: 'slot', activityId: ACTIVITY_ID, eventId: null }, START))?.endsAt).toBeNull();
  });

  it('names the venue when the phone already knows it, for the full schedule', () => {
    const occurrence = coachClassOccurrence(coachClass('Spin', ablerHandle(1) as CoachPlanClass['booking']), (slug) =>
      slug === 'hress' ? VENUE_ID : null,
    );
    expect(occurrence?.venueId).toBe(VENUE_ID);
    expect(coachClassOccurrence(coachClass('Spin', ablerHandle(1) as CoachPlanClass['booking']))?.venueId).toBeNull();
  });
});

describe('finding the class in the feed', () => {
  it('matches the feed row with its title, keeping that row’s own session', () => {
    const rows = [feedItem('Spin 45', ablerHandle(4241)), feedItem('Yoga Flow', ablerHandle(4242))];
    const match = feedOccurrenceMatching(coachClass('Yoga Flow'), rows);
    expect(match?.handle).toEqual({ kind: 'ablerClass', eventId: 4242 });
    expect(match?.venueId).toBe(VENUE_ID);
    expect(match?.surchargeFromIsk).toBe(1_990);
  });

  it('is never guessed between two classes at the same time', () => {
    const rows = [feedItem('Spin 45', ablerHandle(4241)), feedItem('Pilates', ablerHandle(4243))];
    expect(feedOccurrenceMatching(coachClass('Yoga Flow'), rows)).toBeNull();
    expect(feedOccurrenceMatching(coachClass(null), rows)).toBeNull();
  });

  it("takes the venue's only class at that time; another venue or another time is no candidate", () => {
    const rows = [
      feedItem('Yoga Flow 60', ablerHandle(4242)),
      feedItem('Spin 45', ablerHandle(4241), { venueSlug: 'world-class' }),
      feedItem('Pilates', ablerHandle(4243), { at: plus(START, 3600) }),
    ];
    expect(feedOccurrenceMatching(coachClass('Yoga Flow'), rows)?.handle).toEqual({ kind: 'ablerClass', eventId: 4242 });
  });

  it('a start within a minute is the same class; a row this build cannot book is none', () => {
    expect(feedOccurrenceMatching(coachClass('Yoga Flow'), [feedItem('Yoga Flow', ablerHandle(1), { at: plus(START, 59) })])).not.toBeNull();
    expect(feedOccurrenceMatching(coachClass('Yoga Flow'), [feedItem('Yoga Flow', ablerHandle(1), { at: plus(START, 60) })])).toBeNull();
    expect(
      feedOccurrenceMatching(coachClass('Yoga Flow'), [feedItem('Yoga Flow', { kind: 'waitlist', activityId: ACTIVITY_ID })]),
    ).toBeNull();
  });
});

describe('the lookup', () => {
  it("searches the class's day by its title first", async () => {
    const queries: ClassFeedPageQuery[] = [];
    const occurrence = await resolveCoachClassOccurrence(coachClass('Yoga Flow'), {
      fetchPage: async (query) => {
        queries.push(query);
        return page([feedItem('Yoga Flow', ablerHandle(4242))]);
      },
    });
    expect(occurrence?.handle).toEqual({ kind: 'ablerClass', eventId: 4242 });
    expect(queries).toEqual([{ query: 'Yoga Flow', start: '2030-03-14', end: '2030-03-14' }]);
  });

  it('then reads at most three unfiltered pages, following the cursor', async () => {
    const queries: ClassFeedPageQuery[] = [];
    const occurrence = await resolveCoachClassOccurrence(coachClass('Yoga Flow'), {
      fetchPage: async (query) => {
        queries.push(query);
        if (query.query) return page([]);
        const read = queries.length - 1;
        return page(read === 3 ? [feedItem('Yoga Flow', ablerHandle(4242))] : [], `cursor-${read}`);
      },
    });
    expect(occurrence?.handle).toEqual({ kind: 'ablerClass', eventId: 4242 });
    expect(queries.map((query) => query.cursor ?? null)).toEqual([null, null, 'cursor-1', 'cursor-2']);
    expect(queries.slice(1).every((query) => query.query === undefined && query.start === '2030-03-14')).toBe(true);

    // Never past three pages.
    const reads: ClassFeedPageQuery[] = [];
    expect(
      await resolveCoachClassOccurrence(coachClass(null), {
        fetchPage: async (query) => {
          reads.push(query);
          return page([], `c${reads.length}`);
        },
      }),
    ).toBeNull();
    expect(reads).toHaveLength(COACH_CLASS_LOOKUP_PAGES);
  });

  it('a failed search still reads the pages; a failed page ends the reading, and nothing found is null', async () => {
    let calls = 0;
    const found = await resolveCoachClassOccurrence(coachClass('Yoga Flow'), {
      fetchPage: async (query) => {
        calls += 1;
        if (query.query) throw new Error('offline');
        return page([feedItem('Yoga Flow', ablerHandle(4242))]);
      },
    });
    expect(found).not.toBeNull();
    expect(calls).toBe(2);

    let reads = 0;
    expect(
      await resolveCoachClassOccurrence(coachClass(null), {
        fetchPage: async () => {
          reads += 1;
          throw new Error('offline');
        },
      }),
    ).toBeNull();
    expect(reads).toBe(1);
  });

  it("the plan's own handle needs no lookup", async () => {
    const fetchPage = jest.fn();
    const occurrence = await resolveCoachClassOccurrence(coachClass('Spin', ablerHandle(77) as CoachPlanClass['booking']), {
      fetchPage,
      venueIdForSlug: () => VENUE_ID,
    });
    expect(occurrence?.handle).toEqual({ kind: 'ablerClass', eventId: 77 });
    expect(occurrence?.venueId).toBe(VENUE_ID);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('Book opens the class sheet on the session found, or the venue page when there is none', async () => {
    const openSheet = jest.fn();
    const navigation = { navigate: jest.fn() };
    const onBooked = jest.fn();
    expect(
      await bookCoachClass(coachClass('Yoga Flow'), {
        navigation: navigation as never,
        openSheet,
        onBooked,
        fetchPage: async () => page([feedItem('Yoga Flow', ablerHandle(4242))]),
      }),
    ).toBe('sheet');
    expect(openSheet).toHaveBeenCalledWith(expect.objectContaining({ handle: { kind: 'ablerClass', eventId: 4242 } }), {
      onBooked,
      onDismiss: undefined,
    });
    expect(navigation.navigate).not.toHaveBeenCalled();

    expect(
      await bookCoachClass(coachClass('Yoga Flow'), {
        navigation: navigation as never,
        openSheet,
        fetchPage: async () => page([]),
      }),
    ).toBe('venue');
    expect(navigation.navigate).toHaveBeenCalledWith('VenueDetail', { slug: 'hress' });
    expect(openSheet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the session found', () => page([feedItem('Yoga Flow', ablerHandle(4242))])],
    ['no session', () => page([])],
  ])('a sign-out while it looks opens nothing for the next member (%s)', async (_label, answer) => {
    const openSheet = jest.fn();
    const navigation = { navigate: jest.fn() };
    const onDismiss = jest.fn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const looking = bookCoachClass(coachClass('Yoga Flow'), {
      navigation: navigation as never,
      openSheet,
      onDismiss,
      // The public feed still answers after the member has gone.
      fetchPage: async () => {
        await gate;
        return answer();
      },
    });
    await runSignOutCleaners({ memberId: 'member-a' });
    release();
    expect(await looking).toBe('none');
    expect(openSheet).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('passes the opener to return TalkBack focus to', async () => {
    const openSheet = jest.fn();
    const returnFocusRef = { current: null };
    await bookCoachClass(coachClass('Yoga Flow'), {
      navigation: { navigate: jest.fn() } as never,
      openSheet,
      returnFocusRef,
      fetchPage: async () => page([feedItem('Yoga Flow', ablerHandle(4242))]),
    });
    expect(openSheet.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ returnFocusRef }));
  });
});

describe('a Coach slot with no end', () => {
  const handle = { kind: 'slot' as const, activityId: ACTIVITY_ID, eventId: null };

  it('takes its end from the re-check, and is booked with it', async () => {
    respond((request) => {
      if (request.path.endsWith('/availability')) return slotsReply([START]);
      if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
      return Reply.problem(404, 'not_found');
    });
    const occurrence = coachClassOccurrence(coachClass('Spin', handle, null))!;
    const session = testSession();
    await session.prepare(occurrence);
    const s = session.store.getState();
    expect(s.occurrenceStatus).toBe('ready');
    expect(s.selectedSlot?.endTime).toEqual(plus(START, 2700));
  });

  it('cannot be booked blind when the re-check fails', async () => {
    respond(() => Reply.problem(500, 'internal_error'));
    const occurrence = coachClassOccurrence(coachClass('Spin', handle, null))!;
    const session = testSession();
    await session.prepare(occurrence);
    expect(session.store.getState().occurrenceStatus).toBe('unresolved');
    expect(session.store.getState().selectedSlot).toBeNull();
    await session.store.getState().confirmBooking();
    expect(session.store.getState().isBooking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A chat class card (API 0.36.0)

/**
 * The four cards of the server's own recorded answer (iOS
 * `CoachClassCardFixtures.cardsEN`, as the Coach decodes them), on `day`.
 */
function chatCards(day = '2026-10-13'): CoachPlanClass[] {
  const at = (time: string) => new Date(`${day}T${time}Z`);
  return [
    {
      id: 'cls_292c2799eb',
      title: 'HOT FIT',
      startsAt: at('12:10:00'),
      endsAt: at('13:10:00'),
      venueSlug: 'nordur-akureyri',
      venueName: 'Nordur Akureyri',
      booking: { kind: 'class', activityId: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11', eventId: 2_102_243_144, slotStartsAt: null, slotEndsAt: null },
      status: 'open',
      spotsLeft: 18,
      priceLabel: 'Included in your plan',
      surchargeFromIsk: null,
    },
    {
      id: 'cls_be41a59600',
      title: 'Spinning',
      startsAt: at('17:15:00'),
      endsAt: at('18:00:00'),
      venueSlug: 'world-class-skolastigur-akureyri-and-pool',
      venueName: 'World Class Skólastígur Akureyri & Pool',
      booking: { kind: 'class', activityId: '0e8a3d27-5c41-4b6f-9a12-7d3e8f1c2b44', eventId: 539_288_823, slotStartsAt: null, slotEndsAt: null },
      status: 'full',
      spotsLeft: 0,
      priceLabel: 'Included in your plan',
      surchargeFromIsk: null,
    },
    {
      id: 'cls_094a45a28b',
      title: 'Yoga Flow',
      startsAt: at('18:00:00'),
      endsAt: at('19:00:00'),
      venueSlug: 'sjalfsraekt-heilsumidstod',
      venueName: 'Sjálfsrækt heilsumiðstöð',
      booking: { kind: 'class', activityId: 'a4c2e9f1-2b7d-4e3a-8c51-9f0d6b2a3e77', eventId: 743_812_291, slotStartsAt: null, slotEndsAt: null },
      status: 'opens_later',
      spotsLeft: 18,
      priceLabel: 'Included in your plan',
      surchargeFromIsk: null,
    },
    {
      id: 'cls_3d7ee04649',
      title: 'Sauna ritual',
      startsAt: at('19:30:00'),
      endsAt: at('20:00:00'),
      venueSlug: 'forest-lagoon',
      venueName: 'Forest Lagoon',
      booking: { kind: 'slot', activityId: 'd9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88', eventId: null, slotStartsAt: at('19:30:00'), slotEndsAt: at('20:00:00') },
      status: 'open',
      spotsLeft: 9,
      priceLabel: 'From 4,500 ISK',
      surchargeFromIsk: 4500,
    },
  ];
}

describe('a chat class card', () => {
  it('an Abler card books its own event, its verdict seeding the sheet (testAnAblerCardBooksItsOwnEvent)', () => {
    const session = chatCards()[0]!;
    const occurrence = coachClassOccurrence(session)!;
    expect(occurrence.handle).toEqual({ kind: 'ablerClass', eventId: 2_102_243_144 });
    expect(occurrence.activity).toEqual({ id: '6b1f0c52-3a7e-4d19-8f2a-0c9d4e5b7a11', name: 'Nordur Akureyri', provider: 'abler' });
    expect(occurrence.startsAt).toEqual(session.startsAt);
    expect(occurrence.endsAt).toEqual(session.endsAt);
    expect(occurrence.className).toBe('HOT FIT');
    expect(occurrence.venueName).toBe('Nordur Akureyri');
    expect(occurrence.surchargeFromIsk).toBeNull();
    // The card's own verdict seeds the sheet; its re-check replaces it.
    expect(occurrence.snapshot).toEqual({
      canBook: true,
      canBookReason: null,
      full: false,
      attendanceCurrent: 0,
      attendanceLimit: 18,
      registrationOpensAt: null,
    });
  });

  it("each card's verdict rides into the sheet (testEachCardsVerdictRidesIntoTheSheet)", () => {
    const [, full, later, slot] = chatCards();
    expect(coachClassOccurrence(full!)!.snapshot).toEqual(
      expect.objectContaining({ canBook: false, canBookReason: 'class_full', full: true, attendanceLimit: 0 }),
    );
    // The sheet's own "not open yet" wording.
    expect(coachClassOccurrence(later!)!.snapshot).toEqual(
      expect.objectContaining({ canBook: false, canBookReason: 'event_not_open', full: false }),
    );
    expect(coachClassOccurrence(slot!)!.snapshot).toEqual(expect.objectContaining({ canBook: true, attendanceLimit: 9 }));

    // No status and no spots (an older server, or a day plan's class): no
    // verdict, so the sheet seeds exactly as it always has.
    expect(coachCardSnapshot({ status: null, spotsLeft: null })).toBeNull();
    expect(coachCardSnapshot({})).toBeNull();
    // Spots alone say nothing about whether it can be booked.
    expect(coachCardSnapshot({ spotsLeft: 4 })).toEqual(expect.objectContaining({ canBook: null, attendanceLimit: 4 }));
    // A state this build does not know is not bookable.
    expect(coachCardSnapshot({ status: 'waitlist' })?.canBook).toBe(false);
  });

  it("a slot card books the slot's own times with its from price (testASlotCardBooksTheSlotsOwnTimesWithItsFromPrice)", () => {
    const occurrence = coachClassOccurrence(chatCards()[3]!)!;
    expect(occurrence.handle).toEqual({ kind: 'slot' });
    expect(occurrence.activity).toEqual({ id: 'd9b7a1c3-6e2f-4a8d-b5c4-3e1f7a9d0c88', name: 'Sauna ritual', provider: 'internal' });
    expect(occurrence.startsAt).toEqual(new Date('2026-10-13T19:30:00Z'));
    expect(occurrence.endsAt).toEqual(new Date('2026-10-13T20:00:00Z'));
    expect(occurrence.surchargeFromIsk).toBe(4500);
  });

  it("the slot handle's own times win over the class's, and name the session", () => {
    const handle = { kind: 'slot' as const, activityId: ACTIVITY_ID, eventId: null, slotStartsAt: plus(START, 600), slotEndsAt: plus(START, 3000) };
    // A plan class with no end of its own: the handle's end is what books it.
    const occurrence = coachClassOccurrence(coachClass('Spin', handle, null))!;
    expect(occurrence.startsAt).toEqual(plus(START, 600));
    expect(occurrence.endsAt).toEqual(plus(START, 3000));
    expect(occurrence.id).toBe(`coach-plan-class-1-${Math.trunc(plus(START, 600).getTime() / 1000)}`);
    // A pair that is not a start before an end is no pair: the class's times stand.
    const backwards = coachClassOccurrence(coachClass('Spin', { ...handle, slotEndsAt: plus(START, 600) }))!;
    expect(backwards.startsAt).toEqual(START);
    expect(backwards.endsAt).toEqual(plus(START, 3600));
    // A day plan's class carries no "from" price.
    expect(occurrence.surchargeFromIsk).toBeNull();
    expect(occurrence.snapshot).toBeNull();
  });

  it("a card's verdict stands when the sheet's re-check fails (testACardsVerdictStandsWhenTheSheetsRecheckFails)", async () => {
    const classes = chatCards('2030-03-14');
    respond(() => Reply.problem(500, 'internal_error'));

    for (const [index, reason] of [
      [1, 'class_full'],
      [2, 'event_not_open'],
    ] as const) {
      const session = testSession();
      await session.prepare(coachClassOccurrence(classes[index]!)!);
      const s = session.store.getState();
      expect([index, s.occurrenceStatus]).toEqual([index, 'notBookable']);
      expect(canConfirmOccurrence(s)).toBe(false);
      expect(s.selectedClass?.canBookReason).toBe(reason);
      await session.store.getState().confirmBooking();
    }

    const slot = testSession();
    await slot.prepare(coachClassOccurrence(classes[3]!)!);
    // Open: best effort, the create call decides.
    expect(slot.store.getState().occurrenceStatus).toBe('ready');
    expect(slot.store.getState().selectedSlot?.remainingCapacity).toBe(9);
    expect(slot.store.getState().selectedSlot?.endTime).toEqual(new Date('2030-03-14T20:00:00Z'));

    // Nothing was booked.
    expect(api.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/bookings'))).toEqual([]);
  });
});
