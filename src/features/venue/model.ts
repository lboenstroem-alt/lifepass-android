/* eslint lifepass/no-literal-copy: "error" */
/**
 * The venue page's rules, apart from any view: the Android port of the
 * decisions iOS `VenueDetailView` (Views/Venues/VenueDetailView.swift) makes
 * inline. Kept pure so every branch is tested without rendering.
 *
 *   heroKicker          the line above the venue's name
 *   venueContent        which content state the middle of the page shows
 *   venueBar            which floating bar sits above the tab bar
 *   walkInCardPrice     the walk-in card's price line (and its faint second line)
 *   walkInBarPrice      the price a Scan pill carries
 *   activityFromPrice   a premium class row's from-price
 *   hasDirections       whether there is anywhere to give directions to
 *   showsGettingThere   whether "Getting there" is drawn at all
 *   hourText            one weekday's hours
 *   ratingLine          the meta row's rating words
 *   statusBarBandOpacity the band behind the status bar, by scroll offset
 *   venueShareUrl / venueShareMessage / venuePhoneUrl
 *
 * Money: the page RENDERS the server's prices (`inBundle`,
 * `resolvedSurchargePrice`, `topupPrice`, ...), it never works one out. The
 * label rules themselves are F6's (src/types/venue.ts, iOS `Venue.priceLabel`).
 */
import { printfFixed } from '../../i18n/format';
import type { BookableActivity } from '../../api/walkInPreview';
import {
  iskPrefix,
  isBoutique,
  isPremium,
  priceLabel,
  priceSecondaryLabel,
  resolvedPremiumPrice,
  type DayHours,
  type Translate,
  type Venue,
} from '../../types/venue';

/** The designed height of the hero photo block (iOS `heroHeight`). */
export const HERO_HEIGHT = 420;

/** The website routes venues by SLUG; a UUID link 404s. */
export const VENUE_SHARE_BASE = 'https://www.lifepass.is/venues/';

// MARK: - Hero

export interface HeroKicker {
  readonly text: string;
  /** Drawn in the premium accent (lpSignal) rather than paper2. */
  readonly premium: boolean;
}

/**
 * The kicker over the venue's name (iOS heroBlock):
 *   premium with a price  "Premium · from ISK X"
 *   premium without one  "Premium" (never "Premium · See venue")
 *   boutique              "Limited visits"
 *   otherwise             "In your plan"
 */
export function heroKicker(venue: Venue, t: Translate): HeroKicker {
  if (isPremium(venue)) {
    const text =
      resolvedPremiumPrice(venue) !== null ? `${t('venue.premium')} · ${priceLabel(venue, t)}` : t('venue.premium');
    return { text, premium: true };
  }
  if (isBoutique(venue)) return { text: priceLabel(venue, t), premium: false };
  return { text: t('venue.in_your_plan'), premium: false };
}

/** The canonical share link: the web venue page, so a recipient without the app still lands somewhere. */
export function venueShareUrl(venue: Pick<Venue, 'slug'>): string {
  return `${VENUE_SHARE_BASE}${venue.slug}`;
}

/**
 * What the share sheet sends. iOS ShareLink sends the URL as an item with the
 * message beside it; Android's share intent carries one text, so the link
 * goes at the end of the message (plan 5.6), and the name is the subject.
 */
export function venueShareMessage(venue: Pick<Venue, 'slug' | 'name'>, t: Translate): string {
  return `${t('venue.share_message', { name: venue.name })} ${venueShareUrl(venue)}`;
}

// MARK: - Meta row

/**
 * The rating words beside the star: "4.6" and "· 12 reviews" when rated,
 * otherwise "No reviews yet". The count reads `venue.reviews_many` whatever
 * the count, as iOS's meta row does (it never picks `reviews_one` there).
 */
export function ratingLine(
  venue: Pick<Venue, 'averageRating' | 'totalReviews'>,
  t: Translate,
): { readonly rating: string; readonly count: string | null } | { readonly empty: string } {
  const rating = venue.averageRating;
  if (rating !== null && rating > 0) {
    const total = venue.totalReviews;
    return {
      rating: printfFixed(rating, 1),
      count: total !== null && total > 0 ? `· ${t('venue.reviews_many', { count: total })}` : null,
    };
  }
  return { empty: t('venue.no_reviews') };
}

/**
 * Somewhere to go: an address, or a position. Both Directions buttons (the
 * meta row's and the one in "Getting there") hide without one (iOS 2.5.4).
 * A half position never reaches the model (src/api/venues.ts nulls both).
 */
export function hasDirections(venue: Pick<Venue, 'address' | 'latitude' | 'longitude'>): boolean {
  return (venue.address !== null && venue.address.length > 0) || (venue.latitude !== null && venue.longitude !== null);
}

/** "Getting there" shows with an address, a phone or directions (iOS contactBlock). */
export function showsGettingThere(venue: Pick<Venue, 'address' | 'phone' | 'latitude' | 'longitude'>): boolean {
  return venue.address !== null || venue.phone !== null || hasDirections(venue);
}

// MARK: - Hours

export type HourText =
  | { readonly kind: 'closed'; readonly text: string }
  | { readonly kind: 'open'; readonly text: string }
  | { readonly kind: 'unknown'; readonly text: string };

/** One weekday (iOS hoursRow): "Closed" in red, "06:00 – 22:00", or a dash when unknown. */
export function hourText(day: DayHours | null, t: Translate): HourText {
  if (day) {
    if (day.closed === true) return { kind: 'closed', text: t('venue.hours.closed') };
    if (day.open !== null && day.close !== null) return { kind: 'open', text: `${day.open} – ${day.close}` };
  }
  return { kind: 'unknown', text: '—' };
}

// MARK: - Content states

/**
 * What the middle of the page shows (iOS activitiesBlock), in priority order:
 *   comingSoon   the venue is awaiting connection, OR its activities are and
 *                there is neither a bookable class nor walk-ins;
 *   offers       walk-ins and/or bookable classes: BOTH are shown when both
 *                exist (a walk-in venue can list bookable classes too);
 *   unavailable  nothing to book or scan: "Bookings not yet available".
 */
export type VenueContent =
  | { readonly kind: 'comingSoon' }
  | { readonly kind: 'offers'; readonly walkIn: boolean; readonly classes: boolean }
  | { readonly kind: 'unavailable' };

type StateFields = Pick<Venue, 'awaitingConnection' | 'activitiesAwaitingConnection' | 'walkInsAllowed'>;

export function venueContent(venue: StateFields, slotActivities: readonly BookableActivity[]): VenueContent {
  if (
    venue.awaitingConnection === true ||
    (venue.activitiesAwaitingConnection === true && slotActivities.length === 0 && venue.walkInsAllowed !== true)
  ) {
    return { kind: 'comingSoon' };
  }
  const walkIn = venue.walkInsAllowed === true;
  const classes = slotActivities.length > 0;
  if (walkIn || classes) return { kind: 'offers', walkIn, classes };
  return { kind: 'unavailable' };
}

/**
 * The floating bar (iOS floatingAction):
 *   none            awaiting connection, or nothing to book or scan (the
 *                   in-content card says why)
 *   scan            walk-ins, no bookable class: one full-width Scan pill
 *   scanAndClasses  walk-ins AND bookable classes (2.5.4): "Book a class"
 *                   (scrolls to the list) beside "Scan QR"
 *   book            classes only: "Bookable", the FIRST class, and Book
 */
export type VenueBar =
  | { readonly kind: 'none' }
  | { readonly kind: 'scan' }
  | { readonly kind: 'scanAndClasses' }
  | { readonly kind: 'book'; readonly activity: BookableActivity };

export function venueBar(
  venue: Pick<Venue, 'awaitingConnection' | 'walkInsAllowed'>,
  slotActivities: readonly BookableActivity[],
): VenueBar {
  if (venue.awaitingConnection === true) return { kind: 'none' };
  if (venue.walkInsAllowed === true) return slotActivities.length === 0 ? { kind: 'scan' } : { kind: 'scanAndClasses' };
  const first = slotActivities[0];
  return first ? { kind: 'book', activity: first } : { kind: 'none' };
}

// MARK: - Prices

/**
 * The walk-in card's price (iOS walkInCard): the price label at a premium or
 * boutique venue, otherwise "Included in your plan"; then the optional faint
 * top-up, day-pass or extra-visits line.
 */
export function walkInCardPrice(venue: Venue, t: Translate): { readonly primary: string; readonly secondary: string | null } {
  return {
    primary: isPremium(venue) || isBoutique(venue) ? priceLabel(venue, t) : t('venue.included_in_plan'),
    secondary: priceSecondaryLabel(venue, t),
  };
}

/** The price a Scan pill carries (iOS walkInPriceText): "Included", or the premium or boutique label. */
export function walkInBarPrice(venue: Venue, t: Translate): string {
  return isPremium(venue) || isBoutique(venue) ? priceLabel(venue, t) : t('venue.price.included');
}

/**
 * A class row's hint at a premium venue with a price: "from ISK X · exact
 * price at confirm". Per-activity prices are not on the mobile API, so the
 * figure is the venue's and the booking flow discloses the exact one.
 */
export function activityFromPrice(venue: Venue, t: Translate): string | null {
  if (!isPremium(venue)) return null;
  const price = resolvedPremiumPrice(venue);
  return price === null ? null : t('venue.activity.from_price', { price: iskPrefix(price) });
}

// MARK: - Phone

/**
 * The dialler link for "Call the venue": the digits and a leading plus only
 * (iOS filters the same characters). Null when nothing dialable is left.
 */
export function venuePhoneUrl(phone: string | null): string | null {
  if (!phone) return null;
  const dialable = Array.from(phone)
    .filter((c) => /[0-9+]/.test(c))
    .join('');
  return dialable ? `tel:${dialable}` : null;
}

// MARK: - Status-bar band

/** How long the band takes to fade in, in points (iOS `fade`). */
export const STATUS_BAND_FADE = 80;

/**
 * Where the band is fully in: the hero's title block (its bottom third) has
 * reached the covered strip (iOS statusBarBandOpacity).
 */
export function statusBarBandFullAt(coveredTop: number): number {
  return (HERO_HEIGHT * 2) / 3 - coveredTop;
}

/** 0 while the hero sits at the top, 1 once its title block reaches the band, with an 80 pt fade before. */
export function statusBarBandOpacity(scrollOffset: number, coveredTop: number): number {
  const fullAt = statusBarBandFullAt(coveredTop);
  return Math.min(1, Math.max(0, (scrollOffset - (fullAt - STATUS_BAND_FADE)) / STATUS_BAND_FADE));
}
