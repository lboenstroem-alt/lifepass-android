/**
 * Venue page fixtures, in the API's own shape (decoded the way the app
 * decodes them), modelled on iOS `VenueScreenshotFixtures` (a gym with an
 * open floor, a sauna and group classes; walk-ins and/or two Abler classes).
 */
import { decodeVenue } from '../../../api/venues';
import type { BookableActivity, BookingProvider } from '../../../api/walkInPreview';
import type { Venue } from '../../../types/venue';

export const VENUE_ID = '6a1d0c4e-2b7f-4f1e-9c3a-7d5e8f9a0b1c';
export const VENUE_SLUG = 'hress-reykjavik';

export const HOURS = {
  monday: { open: '06:00', close: '22:00' },
  tuesday: { open: '06:00', close: '22:00' },
  wednesday: { open: '06:00', close: '22:00' },
  thursday: { open: '06:00', close: '22:00' },
  friday: { open: '06:00', close: '20:00' },
  saturday: { open: '09:00', close: '18:00' },
  sunday: { closed: true },
};

/** The API's `VenueSummary` for the fixture venue; `overrides` replace fields (null removes one). */
export function venueJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: VENUE_ID,
    slug: VENUE_SLUG,
    name: 'Hress Reykjavík',
    description: 'A friendly gym with an open floor, a sauna and group classes through the week.',
    descriptionIs: 'Vinaleg líkamsræktarstöð með opnu gólfi, gufubaði og hóptímum alla vikuna.',
    address: 'Laugavegur 77, 101 Reykjavík',
    city: 'Reykjavík',
    coordinates: { latitude: 64.1436, longitude: -21.9187 },
    phone: '+354 555 1234',
    categories: ['gym'],
    category: 'gym',
    amenities: ['sauna', 'showers', 'lockers'],
    averageRating: 4.6,
    totalReviews: 12,
    walkInsAllowed: true,
    awaitingConnection: false,
    activitiesAwaitingConnection: false,
    inBundle: true,
    openingHours: HOURS,
    ...overrides,
  };
  for (const [key, value] of Object.entries(json)) if (value === null) delete json[key];
  return json;
}

export function venue(overrides: Record<string, unknown> = {}): Venue {
  return decodeVenue(venueJson(overrides));
}

export const HOT_YOGA: BookableActivity = {
  id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  name: 'Hot Yoga',
  provider: 'abler',
};

export const SPINNING: BookableActivity = {
  id: '1f1e2d3c-4b5a-4968-8776-655443322111',
  name: 'Spinning',
  provider: 'noona',
};

export const CLASSES: readonly BookableActivity[] = [HOT_YOGA, SPINNING];

/** The walk-in preview's answer for the fixture venue. */
export function previewJson(
  slotActivities: readonly { id: string; name: string; provider: BookingProvider | string }[] = CLASSES,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    venue: { id: VENUE_ID, slug: VENUE_SLUG, name: 'Hress Reykjavík' },
    walkInsAllowed: true,
    activities: [],
    slotActivities,
    allowed: true,
    blockingReason: null,
    charge: null,
    attendableBooking: null,
    guestBands: null,
    coveredBy: null,
    ...overrides,
  };
}

export const REVIEW_A = {
  id: 'a1111111-2222-4333-8444-555555555551',
  venueId: VENUE_ID,
  rating: 5,
  comment: 'Lovely sauna, friendly staff and the classes start on time every single morning.',
  visitDate: '2026-10-01',
  isVerifiedVisit: true,
  createdAt: '2026-10-02T09:30:00.000Z',
  updatedAt: '2026-10-02T09:30:00.000Z',
  reviewer: { fullNameInitial: 'A', fullName: null },
  images: [],
};

export const REVIEW_B = {
  ...REVIEW_A,
  id: 'a1111111-2222-4333-8444-555555555552',
  rating: 4,
  comment: 'Good gym floor, a bit busy after work but the staff keep it clean and tidy.',
  createdAt: '2026-09-20T18:00:00.000Z',
};

export const REVIEW_C = {
  ...REVIEW_A,
  id: 'a1111111-2222-4333-8444-555555555553',
  rating: 3,
  comment: 'Fine.',
  createdAt: '2026-09-01T18:00:00.000Z',
};

/** The reviews answer (`GET /venues/{id}/reviews`). */
export function reviewsJson(rows: readonly object[] = [REVIEW_A, REVIEW_B, REVIEW_C]): Record<string, unknown> {
  return {
    summary: { averageRating: 4, totalReviews: rows.length, distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 } },
    rows,
    nextCursor: null,
    canWriteReview: true,
  };
}
