/**
 * Test data for Profile: the member (`GET /profile`, `GET /subscriptions`)
 * as the API sends it, read into the app store through the real decoders,
 * and bookings, favourites and venues as their routes answer.
 */
import { decodeProfile } from '../../../api/profile';
import { decodeSubscription } from '../../../api/subscriptions';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';

export const MEMBER_ID = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
export const VENUE_ID = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

export const LANES = {
  tier: 'plus',
  network: { used: 3, cap: 8, resetsAt: '2026-11-01T00:00:00.000Z' },
  pools: { used: 2, cap: 4, resetsAt: '2026-11-01T00:00:00.000Z' },
};

/** `GET /profile`'s usage block: no tier, no lanes, no passes unless given. */
export function usageJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: [],
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
    ...extra,
  };
}

/** `GET /profile`'s data. */
export function profileJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMBER_ID,
    email: 'anna@example.com',
    fullName: 'Anna Jónsdóttir',
    locale: 'en',
    kennitalaVerified: false,
    marketingConsent: false,
    usage: usageJSON(),
    ...extra,
  };
}

/** `GET /subscriptions`' data for a Plus member. */
export function subscriptionJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productSlug: 'plan-plus',
    productName: 'Plus',
    status: 'active',
    currentPeriodStartsAt: '2026-09-01T10:14:03.512Z',
    currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    ...extra,
  };
}

/** This member signed in and read; the app store derives the language from the profile. */
export function signedInAs(profile: Record<string, unknown>, subscription: Record<string, unknown> | null = null): void {
  resetAppStoreForTests();
  useAppStore.setState({
    isLoading: false,
    isAuthenticated: true,
    userId: MEMBER_ID,
    profile: decodeProfile(profile),
    subscription: decodeSubscription(subscription),
    subscriptionLoaded: true,
  });
}

/** A `GET /bookings` row. */
export function bookingJSON(id: string, startsAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'confirmed',
    startsAt,
    endsAt: startsAt,
    cancelledAt: null,
    cancellationReason: null,
    venue: { id: VENUE_ID, slug: 'laugar', name: 'Laugar Spa' },
    activity: null,
    externalTitle: 'Yoga Flow',
    location: null,
    venueReference: null,
    ...extra,
  };
}

/** A `GET /bookings` page's data. */
export function bookingsPage(rows: readonly unknown[]): Record<string, unknown> {
  return { data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } };
}

/** A `GET /favourites` venue row. */
export function favouriteJSON(venueId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `f${venueId.slice(1)}`,
    venueId,
    slug: `slug-${venueId.slice(0, 4)}`,
    name: `Saved ${venueId.slice(0, 4)}`,
    description: null,
    city: 'Reykjavík',
    address: null,
    inBundle: true,
    imageUrl: null,
    categories: ['spa'],
    createdAt: '2026-10-02T14:00:00.000Z',
    ...extra,
  };
}

/** A `GET /favourites?include=attractions` place row (API 0.45.0 `FavouriteAttraction`). */
export function favouriteAttractionJSON(slug: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `fav-${slug}`,
    attractionId: '33333333-3333-4333-8333-333333333333',
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    localName: slug.charAt(0).toUpperCase() + slug.slice(1),
    kind: 'waterfall',
    kindLabel: 'Waterfall',
    region: 'south',
    regionLabel: 'South Iceland',
    lengthM: null,
    durationMinutes: null,
    difficulty: null,
    difficultyLabel: null,
    outAndBack: false,
    imageUrl: `https://www.lifepass.is/api/v1/attractions/plate/${slug}`,
    imageAlt: slug,
    imageIsMapPlate: true,
    imageCredit: null,
    imageLicense: null,
    createdAt: '2026-10-27T12:00:00.000Z',
    ...extra,
  };
}

/** A `GET /favourites` class row. */
export function favouriteActivityJSON(activityId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `a${activityId.slice(1)}`,
    activityId,
    name: 'Hot Yoga',
    description: null,
    durationMinutes: 60,
    imageUrl: null,
    venueId: VENUE_ID,
    venueSlug: 'laugar',
    venueName: 'Laugar Spa',
    createdAt: '2026-10-02T14:00:00.000Z',
    ...extra,
  };
}

/** A `GET /venues` row (the API's VenueSummary). */
export function venueJSON(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `venue-${id.slice(0, 4)}`,
    name: `Venue ${id.slice(0, 4)}`,
    city: 'Reykjavík',
    categories: ['yoga'],
    inBundle: true,
    ...extra,
  };
}
