/**
 * Fixtures for the booking tests: the iOS ClassBookingSheetTests and
 * BookingMoneyPathTests fixtures, value for value (the activity, a start far
 * enough ahead to always be upcoming, the class and slot replies, the
 * previews), and a session wired to the stub server with the reminders and
 * the profile refresh observed instead of run.
 */
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { toWireDate } from '../../../api/wire';
import type { BookableActivity } from '../../../api/walkInPreview';
import {
  createBookingSession,
  type BookingOccurrence,
  type BookingSessionStore,
  type CreateBookingSessionOptions,
  type OccurrenceSnapshot,
} from '../bookingSession';

export const ACTIVITY_ID = '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34';
export const VENUE_ID = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

/** Far enough ahead to always be upcoming; Reykjavík is UTC, so the venue day is the UTC date. */
export const START = new Date('2030-03-14T10:00:00Z');
export const VENUE_DAY = '2030-03-14';

export const iso = (date: Date): string => toWireDate(date);
export const plus = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

export const ABLER: BookableActivity = { id: ACTIVITY_ID, name: 'Hress', provider: 'abler' };
export const FIRST_PARTY: BookableActivity = { id: ACTIVITY_ID, name: 'Spin', provider: 'internal' };
export const BOKUN: BookableActivity = { id: ACTIVITY_ID, name: 'Sky Lagoon', provider: 'bokun' };

export const OPEN_SNAPSHOT: OccurrenceSnapshot = {
  canBook: true,
  canBookReason: null,
  full: false,
  attendanceCurrent: 3,
  attendanceLimit: 12,
  registrationOpensAt: null,
};

/** What the feed row said about a class it showed as Full. */
export const FULL_SNAPSHOT: OccurrenceSnapshot = {
  canBook: false,
  canBookReason: 'class_full',
  full: true,
  attendanceCurrent: 12,
  attendanceLimit: 12,
  registrationOpensAt: null,
};

export function ablerOccurrence(
  options: { eventId?: number; startsAt?: Date; snapshot?: OccurrenceSnapshot | null } = {},
): BookingOccurrence {
  const startsAt = options.startsAt ?? START;
  return {
    activity: ABLER,
    handle: { kind: 'ablerClass', eventId: options.eventId ?? 4242 },
    startsAt,
    endsAt: plus(startsAt, 3600),
    className: 'Yoga Flow',
    instructor: null,
    room: null,
    snapshot: options.snapshot === undefined ? OPEN_SNAPSHOT : options.snapshot,
  };
}

export function slotOccurrence(endsAt: Date | null, snapshot: OccurrenceSnapshot | null = null): BookingOccurrence {
  return {
    activity: FIRST_PARTY,
    handle: { kind: 'slot' },
    startsAt: START,
    endsAt,
    className: 'Spin',
    instructor: null,
    room: null,
    snapshot,
  };
}

export function klass(
  eventId: number,
  at: Date,
  options: { canBook?: boolean; reason?: string | null; full?: boolean; opensAt?: Date | null; room?: string | null } = {},
): Record<string, unknown> {
  return {
    // The class room (API 0.44.0): only when the test names one, so the
    // other tests read a server from before it.
    ...(options.room !== undefined ? { room: options.room } : {}),
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

export function slotsReply(starts: Date[], extra: Record<string, unknown> = {}): StubReply {
  return Reply.ok({
    activityId: ACTIVITY_ID,
    provider: 'internal',
    slots: starts.map((start) => ({
      startsAt: iso(start),
      endsAt: iso(plus(start, 2700)),
      available: true,
      remainingCapacity: 6,
      title: 'Spin',
    })),
    fetchedAt: iso(new Date()),
    ...extra,
  });
}

export const FREE_PREVIEW = {
  kind: 'free',
  priceIsk: null,
  remainingMonthly: 5,
  isLastBeforeTopUp: false,
};

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

export const consent = (amountIsk: number, kind = 'surcharge'): StubReply =>
  Reply.problem(402, 'charge_consent_required', { offer: { kind, amountIsk } });

/** Requests whose path ends with `suffix` (and `method`), oldest first. */
export function requests(suffix: string, method: 'GET' | 'POST' = 'GET'): StubRequest[] {
  return api.requests.filter((r) => r.method === method && r.path.endsWith(suffix));
}

/** The create POSTs, oldest first. */
export function bookingPosts(): StubRequest[] {
  return api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings');
}

export function sessionPosts(): StubRequest[] {
  return api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings/payment-sessions');
}

export function confirmPosts(): StubRequest[] {
  return api.requests.filter((r) => r.method === 'POST' && r.path === '/bookings/payment-sessions/confirm');
}

/** The body of a request, as an object. */
export function bodyOf(request: StubRequest | undefined): Record<string, unknown> {
  return (request?.body ?? {}) as Record<string, unknown>;
}

export interface TestSession {
  readonly store: BookingSessionStore;
  readonly reminders: jest.Mock;
  readonly refreshCredits: jest.Mock;
}

/** A session on the stub server; reminders and the profile refresh are recorded, not run. */
export function testSession(options: CreateBookingSessionOptions = {}): TestSession {
  const reminders = jest.fn(async () => undefined);
  const refreshCredits = jest.fn(async () => undefined);
  const store = createBookingSession({
    ...options,
    deps: { scheduleCheckInReminder: reminders, refreshCredits, ...options.deps },
  });
  return { store, reminders, refreshCredits };
}

/** A responder, iOS `StubServer.respond` style. */
export function respond(handler: (request: StubRequest) => StubReply | Promise<StubReply>): void {
  api.respond = handler;
}

/** Lets promise chains and zero-length waits run. */
export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
