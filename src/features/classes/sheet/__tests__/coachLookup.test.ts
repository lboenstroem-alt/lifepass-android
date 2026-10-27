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
 */
import { Reply } from '@test/server';

import { decodeClassFeedItem, type ClassFeedItem, type ClassFeedPage, type ClassFeedPageQuery } from '../../../../api/classFeed';
import { stubApiClientPerTest } from '../../../../api/testing';
import { runSignOutCleaners } from '../../../../app/signOut';
import {
  bookCoachClass,
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
  return { id: 'plan-class-1', title, startsAt: START, endsAt, venueSlug: 'hress', venueName: 'Hress', room: null, booking };
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
