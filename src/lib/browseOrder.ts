// THE ORDER OF THE VENUE LISTS: Explore's venue list and the list behind
// Home's shelves. The Android port of iOS VenueOrdering.swift (`VenueBrand`,
// `VenueBrowseOrder`); the web's Browse grid follows the same four rules
// (apps/web/src/lib/browse-venue-order.ts, mirrored key for key), strongest
// first:
//
//   1. BOOKABLE BEFORE "COMING SOON". A venue still awaiting its booking
//      connection never sits above one that can be visited, in any mode: with
//      or without location, with any filter or search.
//   2. DISTANCE BAND, only with a REAL fix (the location store's granted fix,
//      never the Reykjavík fallback), held still by the browse session's
//      origin. The bands are ./geo.ts's, and rotation never lifts a venue
//      across one.
//   3. ROTATION. A seeded shuffle, one seed per VISIT (src/stores/browseSession:
//      a launch, or coming back after 30 minutes or more away), so a member
//      sees a different mix each time they come back and the same mix while
//      they use the app: filters, tab switches and navigation never reshuffle.
//      Every BRAND gets one key and every venue one more, so a chain with eight
//      locations is no likelier to lead than a solo venue, and which of its
//      locations shows first rotates too.
//   4. CHAINS SPREAD OUT: `interleaveByBrand` inside each band.
//
// Every step is a pure function of (venues, seed, origin), and the keys belong
// to the venue, never to its position, so the input order does not matter.
// Order the FULL list once and filter afterwards (or use `orderWithin`), so
// narrowing a list never reshuffles what is left.
//
// The location never leaves the phone: the bands are computed here.
import { isComingSoon } from '../types/venue';
import { proximityBandAround, type Coordinate, type MaybeLocated, type ProximityBand } from './geo';

/** What the order reads from a venue. */
export type BrowseVenue = MaybeLocated & {
  readonly id: string;
  readonly name: string;
  readonly awaitingConnection?: boolean | null;
};

// MARK: - Brands

/**
 * Unicode White_Space, as Swift's `Character.isWhitespace` splits on (JS `\s`
 * misses U+0085 and adds U+FEFF).
 */
const WHITESPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

/** Combining marks left behind by NFD: what a diacritic fold removes. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * A venue's brand: the first word of its name, accents folded, lower-cased
 * (iOS `VenueBrand.key`, the web's `brandKey`). Recognises chains such as
 * World Class or Sporthúsið without a list of partner names.
 *
 *   "World Class Reykjavík"  → "world"
 *   "Hressó"                 → "hresso"
 *   "  Sky Lagoon "          → "sky"
 *
 * Folded without a locale (NFD, marks dropped), so the key is the same on
 * every phone and matches the web.
 */
export function brandKey(name: string): string {
  const first = name.split(WHITESPACE).find((word) => word.length > 0) ?? name;
  return first.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/**
 * Round-robin over brands in the order each brand first appears: one item per
 * brand per pass (iOS `VenueBrand.interleaved`). The relative order inside a
 * brand, and between brands, is kept; only the spacing of same-brand items
 * changes. A list of distinct brands comes back unchanged.
 */
export function interleaveByBrand<T>(items: readonly T[], name: (item: T) => string): T[] {
  const groups: T[][] = [];
  const indexOf = new Map<string, number>();
  for (const item of items) {
    const key = brandKey(name(item));
    const index = indexOf.get(key);
    if (index === undefined) {
      indexOf.set(key, groups.length);
      groups.push([item]);
    } else {
      groups[index].push(item);
    }
  }
  const result: T[] = [];
  const longest = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let pass = 0; pass < longest; pass += 1) {
    for (const group of groups) {
      if (pass < group.length) result.push(group[pass]);
    }
  }
  return result;
}

// MARK: - Keys

/**
 * The rotation key of `value` under `seed`: FNV-1a over the string's UTF-16
 * code units, XOR the mixed seed, then murmur3's finaliser. The web computes
 * the same number for the same (seed, value), so one seed gives one order on
 * both. Not cryptographic and not meant to be.
 */
export function rotationKey(seed: number, value: string): number {
  return mix32((fnv1a(value) ^ mix32(seed)) >>> 0);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** murmur3 fmix32, in unsigned 32-bit arithmetic. */
function mix32(value: number): number {
  let x = value >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** A seed is an unsigned 32-bit integer. */
export const MAX_SEED = 0xffffffff;

/** A fresh seed for a new visit. */
export function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1)) >>> 0;
}

// MARK: - The order

/** The distance band of `venue` around `origin`; no coordinates is `fartherAway`. */
export function bandOf(venue: MaybeLocated, origin: Coordinate): ProximityBand {
  return proximityBandAround(venue, origin);
}

/** The browse order of `venues` (see the rules at the top of this file). */
export function browseOrder<V extends BrowseVenue>(venues: readonly V[], seed: number, origin: Coordinate | null): V[] {
  // One key per brand, then one per venue: brands rotate as units, so a chain
  // leads no more often than a solo venue, and its own locations rotate under
  // it. The id is the last tiebreak, so equal keys still give one answer.
  const rotated = venues
    .map((venue) => {
      const id = venue.id.toLowerCase();
      return {
        venue,
        brand: rotationKey(seed, `brand:${brandKey(venue.name)}`),
        own: rotationKey(seed, `venue:${id}`),
        id,
      };
    })
    .sort((a, b) => {
      if (a.brand !== b.brand) return a.brand - b.brand;
      if (a.own !== b.own) return a.own - b.own;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map(({ venue }) => venue);

  const arrange = (group: V[]): V[] => {
    if (!origin) return interleaveByBrand(group, (venue) => venue.name);
    const bands = new Map<number, V[]>();
    for (const venue of group) {
      const band = bandOf(venue, origin);
      const members = bands.get(band);
      if (members) members.push(venue);
      else bands.set(band, [venue]);
    }
    return [...bands.keys()]
      .sort((a, b) => a - b)
      .flatMap((band) => interleaveByBrand(bands.get(band) ?? [], (venue) => venue.name));
  };

  return [
    ...arrange(rotated.filter((venue) => !isComingSoon(venue))),
    ...arrange(rotated.filter((venue) => isComingSoon(venue))),
  ];
}

/**
 * `venues` in the order they hold inside the browse order of `catalog` and
 * `venues` together: the catalog is ordered once and `venues` is what is left
 * of it. A server-side search or filter then never reshuffles the venues it
 * keeps (brand spacing over a smaller list would). A venue the catalog lacks
 * is ordered with it; the row in `venues` wins over the catalog's older copy.
 * With no catalog yet, `venues` is ordered on its own.
 */
export function browseOrderWithin<V extends BrowseVenue>(
  venues: readonly V[],
  catalog: readonly V[],
  seed: number,
  origin: Coordinate | null,
): V[] {
  if (catalog.length === 0) return browseOrder(venues, seed, origin);
  const byId = new Map<string, V>();
  for (const venue of catalog) byId.set(venue.id.toLowerCase(), venue);
  for (const venue of venues) byId.set(venue.id.toLowerCase(), venue);
  const kept = new Set(venues.map((venue) => venue.id.toLowerCase()));
  return browseOrder([...byId.values()], seed, origin).filter((venue) => kept.has(venue.id.toLowerCase()));
}

/**
 * Stable partition: every bookable venue, then every "coming soon" one, each
 * side in the order given. For lists ranked by something else (Home's nearest
 * and most-reviewed shelves).
 */
export function comingSoonLast<V extends { readonly awaitingConnection?: boolean | null }>(venues: readonly V[]): V[] {
  return [...venues.filter((venue) => !isComingSoon(venue)), ...venues.filter((venue) => isComingSoon(venue))];
}
