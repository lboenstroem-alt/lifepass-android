/**
 * Fixtures for the class sheet tests: iOS ClassBookingSheetTests' fixtures,
 * value for value (the activity, a start far enough ahead to always be
 * upcoming, the class and slot replies, the previews), as the feed hands the
 * sheet a session (`ClassOccurrence`), and a booking session wired to the
 * stub server with the reminders and the profile refresh recorded instead of
 * run.
 */
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { toWireDate } from '../../../../api/wire';
import { createBookingSession, type BookingSessionStore, type CreateBookingSessionOptions } from '../../../booking';
import type { ClassOccurrence, ClassOccurrenceSnapshot } from '../../model/occurrence';
import { toBookingOccurrence } from '../model';
import type { ClassSheetPages } from '../pages';
import type { ReturnHow } from '../returnWatch';

export const ACTIVITY_ID = '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34';
export const VENUE_ID = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

/** Far enough ahead to always be upcoming; Reykjavík is UTC, so the venue day is the UTC date. */
export const START = new Date('2030-03-14T10:00:00Z');
export const VENUE_DAY = '2030-03-14';

export const iso = (date: Date): string => toWireDate(date);
export const plus = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

export const OPEN_SNAPSHOT: ClassOccurrenceSnapshot = {
  canBook: true,
  canBookReason: null,
  full: false,
  attendanceCurrent: 3,
  attendanceLimit: 12,
  registrationOpensAt: null,
};

/** What the feed row said about a class it showed as Full. */
export const FULL_SNAPSHOT: ClassOccurrenceSnapshot = {
  canBook: false,
  canBookReason: 'class_full',
  full: true,
  attendanceCurrent: 12,
  attendanceLimit: 12,
  registrationOpensAt: null,
};

/** An Abler class as a feed row hands it to the sheet. */
export function ablerOccurrence(
  options: { eventId?: number; startsAt?: Date; snapshot?: ClassOccurrenceSnapshot | null; surchargeFromIsk?: number | null } = {},
): ClassOccurrence {
  const startsAt = options.startsAt ?? START;
  const eventId = options.eventId ?? 4242;
  return {
    id: `occ-${eventId}`,
    activity: { id: ACTIVITY_ID, name: 'Hress', provider: 'abler' },
    venueId: VENUE_ID,
    venueSlug: 'hress',
    handle: { kind: 'ablerClass', eventId },
    startsAt,
    endsAt: plus(startsAt, 3600),
    className: 'Yoga Flow',
    venueName: 'Hress',
    instructor: null,
    surchargeFromIsk: options.surchargeFromIsk ?? null,
    snapshot: options.snapshot === undefined ? OPEN_SNAPSHOT : options.snapshot,
  };
}

/** A first-party class, booked by its slot times. */
export function slotOccurrence(endsAt: Date | null, snapshot: ClassOccurrenceSnapshot | null = null): ClassOccurrence {
  return {
    id: 'occ-slot',
    activity: { id: ACTIVITY_ID, name: 'Spin', provider: 'internal' },
    venueId: VENUE_ID,
    venueSlug: 'lifepass-studio',
    handle: { kind: 'slot' },
    startsAt: START,
    endsAt,
    className: 'Spin',
    venueName: 'LifePass Studio',
    instructor: null,
    surchargeFromIsk: 1_990,
    snapshot,
  };
}

export function klass(
  eventId: number,
  at: Date,
  options: { canBook?: boolean; reason?: string | null; full?: boolean; opensAt?: Date | null } = {},
): Record<string, unknown> {
  return {
    eventId,
    name: `Class ${eventId}`,
    description: null,
    start: iso(at),
    end: iso(plus(at, 3600)),
    location: null,
    coaches: [{ firstName: 'Sigrún', lastName: 'Jónsdóttir', picture: null }],
    attendance: { current: 3, limit: 12 },
    full: options.full ?? false,
    canBook: options.canBook ?? true,
    canBookReason: options.reason ?? null,
    registrationOpensAt: options.opensAt ? iso(options.opensAt) : null,
  };
}

export function classesReply(classes: Record<string, unknown>[]): StubReply {
  return Reply.ok({ activityId: ACTIVITY_ID, provider: 'abler', classes, fetchedAt: iso(new Date()) });
}

export function slotsReply(starts: Date[]): StubReply {
  return Reply.ok({
    activityId: ACTIVITY_ID,
    provider: 'internal',
    slots: starts.map((start) => ({
      startsAt: iso(start),
      endsAt: iso(plus(start, 2700)),
      available: true,
      remainingCapacity: 6,
      instructor: null,
      title: 'Spin',
    })),
    fetchedAt: iso(new Date()),
  });
}

export const FREE_PREVIEW = { kind: 'free', priceIsk: null, remainingMonthly: 5, isLastBeforeTopUp: false };

export const SURCHARGE_PREVIEW = {
  kind: 'surcharge',
  surchargeReason: 'boutique_access',
  priceIsk: 1_990,
  remainingMonthly: null,
  isLastBeforeTopUp: false,
};

export const RUNG_CHOICE_PREVIEW = {
  kind: 'surcharge',
  surchargeReason: 'premium_subscriber_visit',
  priceIsk: 1_500,
  remainingMonthly: 4,
  isLastBeforeTopUp: false,
  visitChoice: {
    selected: 'spend_visit',
    options: [
      { choice: 'spend_visit', priceIsk: 1_500, consumesVisit: true, surchargeReason: 'premium_subscriber_visit' },
      { choice: 'keep_visit', priceIsk: 4_900, consumesVisit: false, surchargeReason: 'premium_visit_kept' },
    ],
  },
};

export const CONFIRMED = { bookingId: '7a1c2b3d-0000-4000-8000-000000000009', status: 'confirmed' };

export const SESSION_REDIRECT = Reply.ok({
  hasCard: false,
  sessionId: '8b2c3d4e-0000-4000-8000-000000000001',
  externalSessionId: 'kling_cs_class',
  url: 'https://pay.kling.is/c/kling_cs_class',
  amountIsk: 1_990,
});

export const FULFILLED = Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' });

export const consent = (amountIsk: number, kind = 'surcharge'): StubReply =>
  Reply.problem(402, 'charge_consent_required', { offer: { kind, amountIsk } });

/** Requests whose path ends with `suffix` (and `method`), oldest first. */
export function requests(suffix: string, method: 'GET' | 'POST' = 'GET'): StubRequest[] {
  return api.requests.filter((r) => r.method === method && r.path.endsWith(suffix));
}

export const bookingPosts = (): StubRequest[] => api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings');
export const sessionPosts = (): StubRequest[] =>
  api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings/payment-sessions');
export const confirmPosts = (): StubRequest[] =>
  api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings/payment-sessions/confirm');

/** The body of a request, as an object. */
export function bodyOf(request: StubRequest | undefined): Record<string, unknown> {
  return (request?.body ?? {}) as Record<string, unknown>;
}

/** A responder, iOS `StubServer.respond` style. */
export function respond(handler: (request: StubRequest) => StubReply | Promise<StubReply>): void {
  api.respond = handler;
}

/**
 * A card-less member's class: the create asks consent (at `offer`), then says
 * there is no card; the session and its confirm answer as given.
 * `bookingReply` answers any create after those two.
 */
export function cardlessClassServer(
  options: {
    preview?: unknown;
    offer?: number;
    offerKind?: string;
    session?: StubReply;
    confirm?: StubReply;
    bookingReply?: StubReply;
  } = {},
): void {
  let creates = 0;
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(options.preview ?? SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions/confirm') return options.confirm ?? FULFILLED;
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') return options.session ?? SESSION_REDIRECT;
    if (request.method === 'POST' && request.path === '/bookings') {
      creates += 1;
      if (creates > 2 && options.bookingReply) return options.bookingReply;
      return bodyOf(request).acceptCharge === true
        ? Reply.problem(402, 'no_payment_method_on_file')
        : consent(options.offer ?? 1_990, options.offerKind ?? 'surcharge');
    }
    return Reply.problem(404, 'not_found');
  });
}

export interface TestSession {
  readonly store: BookingSessionStore;
  readonly reminders: jest.Mock;
  readonly refreshCredits: jest.Mock;
  /** The sheet's `prepare`, as the sheet calls it for a feed row. */
  prepare(occurrence: ClassOccurrence): Promise<void>;
}

/** A session on the stub server; reminders and the profile refresh are recorded, not run. */
export function testSession(options: CreateBookingSessionOptions = {}): TestSession {
  const reminders = jest.fn(async () => undefined);
  const refreshCredits = jest.fn(async () => undefined);
  const store = createBookingSession({
    ...options,
    deps: { scheduleCheckInReminder: reminders, refreshCredits, ...options.deps },
  });
  return {
    store,
    reminders,
    refreshCredits,
    prepare: (occurrence) => store.getState().prepare(toBookingOccurrence(occurrence)),
  };
}

/** The session dependencies the sheet's own store gets in a screen test. */
export function sheetSessionOptions(): { options: CreateBookingSessionOptions; reminders: jest.Mock } {
  const reminders = jest.fn(async () => undefined);
  return {
    options: { deps: { scheduleCheckInReminder: reminders, refreshCredits: async () => undefined } },
    reminders,
  };
}

/** Lets promise chains and zero-length waits run. */
export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Pages for the sheet that record what it opened, and let a test say when
 * the member comes back (`returnFrom('back')`) or the place has gone.
 */
export interface FakePages extends ClassSheetPages {
  readonly opened: { readonly name: string; readonly params?: object }[];
  readonly watching: () => boolean;
  returnFrom(how?: ReturnHow): void;
  /** False: nothing can be opened (the app is not on screen). */
  canOpen: boolean;
}

export function fakePages(venues: Record<string, string> = {}): FakePages {
  const opened: { name: string; params?: object }[] = [];
  let watcher: ((how: ReturnHow) => void) | null = null;
  const pages: FakePages = {
    opened,
    canOpen: true,
    watching: () => watcher !== null,
    openSharedRoute(name, params) {
      if (!pages.canOpen) return false;
      opened.push({ name, params });
      return true;
    },
    openPlans() {
      if (!pages.canOpen) return false;
      opened.push({ name: 'Plans' });
      return true;
    },
    watchForReturn(onReturn) {
      watcher = onReturn;
      return () => {
        if (watcher === onReturn) watcher = null;
      };
    },
    venueIdForSlug: (slug) => venues[slug] ?? null,
    returnFrom(how = 'back') {
      const current = watcher;
      watcher = null;
      current?.(how);
    },
  };
  return pages;
}
