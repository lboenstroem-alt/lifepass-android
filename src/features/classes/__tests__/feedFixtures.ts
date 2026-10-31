/**
 * Class feed fixtures for the tests: the JSON the server sends (iOS
 * ClassesNextMatchTests / ClassDistanceTests `classJSON`), the success
 * envelope around a page, and the venue-local day helpers.
 */
import { Reply, type StubReply } from '@test/server';

import { decodeClassFeedItem, type ClassFeedItem } from '../../../api/classFeed';
import type { Coordinate } from '../../../lib/geo';

export interface FixtureVenue {
  readonly name: string;
  readonly lat: number | null;
  readonly lon: number | null;
}

/** Reykjavík centre, the app's own fallback origin. */
export const REYKJAVIK: Coordinate = { latitude: 64.1466, longitude: -21.9426 };
/** A member really in Akureyri. */
export const AKUREYRI: Coordinate = { latitude: 65.6839, longitude: -18.0906 };

/** Hress in Hafnarfjörður, ~9 km from the centre. */
export const HRESS: FixtureVenue = { name: 'Hress', lat: 64.0671, lon: -21.9577 };
/** A studio ~0.4 km from the centre. */
export const NEARBY: FixtureVenue = { name: 'Nearby Studio', lat: 64.145, lon: -21.935 };
/** Forest Lagoon by Akureyri. */
export const FOREST: FixtureVenue = { name: 'Forest Lagoon', lat: 65.695, lon: -18.07 };
/** A venue with no coordinates. */
export const NOWHERE: FixtureVenue = { name: 'Nowhere Gym', lat: null, lon: null };

let nextId = 1;

/** A fresh lowercase UUID (stable across a run, unique per call). */
export function uuid(): string {
  nextId += 1;
  const hex = nextId.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

let nextEventId = 1000;

export interface ClassJSONOptions {
  readonly name?: string | null;
  readonly venue?: FixtureVenue;
  readonly startsAt: Date;
  readonly category?: string;
  readonly booking?: Record<string, unknown>;
  readonly extra?: Record<string, unknown>;
}

/** One `ClassFeedItem` as the server writes it. */
export function classJSON({
  name = 'Pilates',
  venue = HRESS,
  startsAt,
  category = 'pilates',
  booking,
  extra = {},
}: ClassJSONOptions): Record<string, unknown> {
  nextEventId += 1;
  return {
    source: 'abler',
    name,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    instructor: null,
    locationText: null,
    attendance: { current: 3, limit: 12 },
    full: false,
    canBook: true,
    canBookReason: null,
    registrationOpensAt: null,
    categorySlugs: [category],
    surchargeFromIsk: null,
    venue: {
      id: uuid(),
      slug: venue.name.toLowerCase().replace(/ /g, '-'),
      name: venue.name,
      coordinates: venue.lat === null || venue.lon === null ? null : { latitude: venue.lat, longitude: venue.lon },
    },
    booking: booking ?? { kind: 'class', activityId: uuid(), eventId: nextEventId },
    ...extra,
  };
}

/** A decoded item. */
export function classItem(options: ClassJSONOptions): ClassFeedItem {
  return decodeClassFeedItem(classJSON(options));
}

/** The `{ ok, data }` envelope around one page. */
export function page(classes: readonly Record<string, unknown>[], next: string | null = null): StubReply {
  return Reply.ok({ classes, nextCursor: next, fetchedAt: new Date().toISOString() });
}

/** Venue-local (UTC) midnight `days` from `from`'s day, plus `hour` hours. */
export function day(days: number, hour = 0, from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days, hour));
}
