// The venue domain model: the Android port of iOS `Venue` (Models/Venue.swift).
//
// One shape for `GET /venues` rows and `GET /venues/by-slug/{slug}` (the API's
// `VenueSummary`, decoded by src/api/venues.ts). Every optional field is
// `null` when the server sent nothing, never a made-up default:
//   - no coordinates is `null`, never 0,0: such a venue is not drawn on the
//     map and sorts into the farthest browse band, but is never dropped;
//   - no `imageUrl` is `null`: the UI draws the ink3 photo placeholder
//     (components/ui/VenueImage), never a stock photo;
//   - no `inBundle` reads as `false`, so a premium venue is never shown as
//     included and its surcharge hidden.
//
// The retired credit wallet and the basic/luxury classification are gone:
// venues are inside the tier bundle (free within the monthly cap) or premium
// (charged à la carte). See docs/08 and the openapi `VenueSummary`.
import { iskPrefix as formatIskPrefix } from '../i18n/format';
import { t as translateCurrent, type Params } from '../i18n';

/** One weekday's hours, as the API sends them (`{ open, close, closed }`). */
export interface DayHours {
  readonly open: string | null;
  readonly close: string | null;
  readonly closed: boolean | null;
}

/** Weekly opening hours. A missing day has no hours to show. */
export interface OpeningHours {
  readonly monday: DayHours | null;
  readonly tuesday: DayHours | null;
  readonly wednesday: DayHours | null;
  readonly thursday: DayHours | null;
  readonly friday: DayHours | null;
  readonly saturday: DayHours | null;
  readonly sunday: DayHours | null;
}

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Venue {
  /** Lower-case UUID. */
  readonly id: string;
  /** The API's canonical venue identifier: `GET /venues/by-slug/{slug}`. */
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  /** Shown instead of `description` when the account language is Icelandic. */
  readonly descriptionIs: string | null;
  readonly address: string | null;
  readonly city: string | null;
  /** Both or neither: a half position is no position. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly imageUrl: string | null;
  /** Display tags, the API's `categories` (iOS names this `category`). */
  readonly categories: readonly string[] | null;
  /**
   * The singular access category (`gym`, `pool`, `boutique`, ...), the API's
   * `category`. Drives boutique detection and the map ring, as on the web.
   */
  readonly primaryCategory: string | null;
  readonly walkInsAllowed: boolean | null;
  readonly phone: string | null;
  readonly amenities: readonly string[] | null;
  readonly averageRating: number | null;
  readonly totalReviews: number | null;
  readonly displayOrder: number | null;
  /** "Coming soon": listed, but not yet connected for booking or check-in. */
  readonly awaitingConnection: boolean | null;
  /**
   * Live venue whose activities are not connected to a provider yet: the
   * venue page says "coming soon" rather than a generic "not available".
   */
  readonly activitiesAwaitingConnection: boolean | null;
  /** Null hides the hours block. */
  readonly openingHours: OpeningHours | null;
  /**
   * The canonical keys the server derives from tags and amenities ("pool",
   * "sauna", "lagoon", ...), read by the map ring. Null from an older server
   * or a value that is not a list; a list keeps its strings only.
   */
  readonly offerings: readonly string[] | null;
  /** The ring type if a server sends one; a valid value overrides the app's own. */
  readonly markerType: string | null;

  // v1 pricing: render these, never do tier math.
  /** Inside the tier bundle (free within cap). False when absent. */
  readonly inBundle: boolean;
  /** Premium venue's standard "from" price (ISK). */
  readonly surchargePrice: number | null;
  /** The surcharge resolved for THIS caller, server-side. */
  readonly resolvedSurchargePrice: number | null;
  /** In-bundle secondary lines: top-up (over cap) and day pass (ISK). */
  readonly topupPrice: number | null;
  readonly daypassPrice: number | null;
}

/** "Coming soon": the browse order puts these after every venue that can be visited. */
export function isComingSoon(venue: { readonly awaitingConnection?: boolean | null }): boolean {
  return venue.awaitingConnection === true;
}

/** Display text in the account language: Icelandic when there is one, else the English. */
export function localizedDescription(venue: Pick<Venue, 'description' | 'descriptionIs'>, language: string): string | null {
  return language === 'is' ? (venue.descriptionIs ?? venue.description) : venue.description;
}

/** The venue's photos (one today); empty when it has none. */
export function venueImages(venue: Pick<Venue, 'imageUrl'>): string[] {
  return venue.imageUrl ? [venue.imageUrl] : [];
}

// MARK: - Pricing display (v1)

/**
 * What the price rules read. Optional fields accept `undefined` as well as
 * `null`, so a card built from another shape (a Coach venue card) can pass
 * what it has.
 */
export interface VenuePricing {
  readonly inBundle: boolean;
  readonly surchargePrice?: number | null;
  readonly resolvedSurchargePrice?: number | null;
  readonly topupPrice?: number | null;
  readonly daypassPrice?: number | null;
  readonly primaryCategory?: string | null;
}

/** `t` or a `useT().t`: a key and its `{params}` in, the words out. */
export type Translate = (key: string, params?: Params) => string;

/** Premium = charged à la carte (not in the bundle). */
export function isPremium(venue: VenuePricing): boolean {
  return !venue.inBundle;
}

/**
 * Boutiques are in the bundle but tier-capped with a small allowance, so
 * "Included" would oversell them. Keyed off the singular access category, as
 * the web's boutique special case is.
 */
export function isBoutique(venue: VenuePricing): boolean {
  return venue.primaryCategory?.toLowerCase() === 'boutique';
}

/** The caller-resolved premium price, falling back to the standard "from". */
export function resolvedPremiumPrice(venue: VenuePricing): number | null {
  return venue.resolvedSurchargePrice ?? venue.surchargePrice ?? null;
}

/**
 * Customer-facing ISK price in prefix form, "ISK 1,990", with en-US grouping
 * in BOTH languages (the web's `formatISKPrefix`; "ISK 1.990" would read as
 * one point nine nine on an English phone).
 */
export function iskPrefix(value: number): string {
  return formatIskPrefix(value);
}

/**
 * The primary price label for cards and pills (the web rule):
 *   premium   "from ISK X", or "See venue" when no figure exists (a backend
 *             data gap: no bare "Premium", and no price we do not have);
 *   boutique  "Limited visits" (its price moves to the secondary line);
 *   in-bundle "Included".
 *
 * Pass `useT().t` from a component so the label follows a language change;
 * the default reads the language on screen now.
 */
export function priceLabel(venue: VenuePricing, translate: Translate = translateCurrent): string {
  if (isPremium(venue)) {
    const price = resolvedPremiumPrice(venue);
    if (price !== null) return translate('venue.price.from', { price: iskPrefix(price) });
    return translate('venue.price.see_venue');
  }
  if (isBoutique(venue)) return translate('venue.price.limited');
  return translate('venue.price.included');
}

/**
 * The optional faint line under `priceLabel` (the web rule):
 *   boutique  "Extra visits from ISK X" (top-up price), or none;
 *   in-bundle "Top-up from ISK X", else "Day pass from ISK X", else none;
 *   premium   none.
 */
export function priceSecondaryLabel(venue: VenuePricing, translate: Translate = translateCurrent): string | null {
  if (isPremium(venue)) return null;
  const topup = venue.topupPrice ?? null;
  if (isBoutique(venue)) {
    return topup !== null ? translate('venue.price.extra_from', { price: iskPrefix(topup) }) : null;
  }
  if (topup !== null) return translate('venue.price.topup_from', { price: iskPrefix(topup) });
  const daypass = venue.daypassPrice ?? null;
  if (daypass !== null) return translate('venue.price.daypass_from', { price: iskPrefix(daypass) });
  return null;
}

// MARK: - Legacy shapes (deleted by QA-1)
//
// The screens written before the parity build read a venue with the retired
// credit and classification fields and a list of activities built from a
// direct Supabase table read. They import these under their old names
// (`LegacyVenue as Venue`) until their owners rewrite them on `Venue` above
// (HOME-1, EXPL-1, EXPL-2, VENUE-1, VENUE-2, LIB-1, BOOK-1, COACH-1,
// CHECKIN-1). src/supabase/services/venues.ts builds them from the API model,
// so even the old screens get no stock photo and no 0,0 position.

/** @deprecated Legacy screens only; use `Venue`. */
export type VenueClassification = 'basic' | 'luxury';

/** @deprecated Legacy screens only; use `DayHours`. */
export interface LegacyOpeningHoursDay {
  open?: string;
  close?: string;
  closed?: boolean;
}

/** @deprecated Legacy screens only; use `OpeningHours`. */
export interface LegacyOpeningHours {
  monday?: LegacyOpeningHoursDay;
  tuesday?: LegacyOpeningHoursDay;
  wednesday?: LegacyOpeningHoursDay;
  thursday?: LegacyOpeningHoursDay;
  friday?: LegacyOpeningHoursDay;
  saturday?: LegacyOpeningHoursDay;
  sunday?: LegacyOpeningHoursDay;
}

/** @deprecated Legacy screens only; activities come from the walk-in preview now. */
export interface LegacyActivity {
  id: string;
  name: string;
  /** Empty when the activity has no photo (never a stock photo). */
  imageUrl: string;
  creditCost: number;
  durationMinutes: number;
  classification: VenueClassification;
}

/** @deprecated Legacy screens only. */
export interface LegacyVenueReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: Date;
}

/** @deprecated Legacy screens only; use `Venue`. */
export interface LegacyVenue {
  id: string;
  slug?: string;
  name: string;
  description: string;
  address: string;
  city: string;
  /** Null without a position: never 0,0. */
  latitude: number | null;
  longitude: number | null;
  /** Empty without a photo: never a stock photo. */
  imageUrl: string;
  classification: VenueClassification;
  category: string[];
  primaryCategory?: string;
  creditCost: number;
  walkInsAllowed: boolean;
  walkInCreditCost: number;
  amenities: string[];
  openingHours: LegacyOpeningHours;
  phone: string;
  averageRating: number;
  totalReviews: number;
  activities: LegacyActivity[];
  reviews: LegacyVenueReview[];
  specialInstructions?: string;
  inBundle: boolean;
  surchargePrice?: number;
  resolvedSurchargePrice?: number;
  topupPrice?: number;
  daypassPrice?: number;
}
