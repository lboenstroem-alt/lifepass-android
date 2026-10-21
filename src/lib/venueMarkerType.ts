// What kind of place a venue pin is on the Explore map (2.5.5): the Android
// port of iOS `VenueMarkerType` (Models/CategoryMapping.swift), itself a port
// of the web's rule (apps/web/src/lib/venue-marker-class.ts, the words and the
// summary from lib/venue-marker-type.ts), so a venue wears the same ring on a
// phone as on the laptop.
//
// The ring around a venue's photo says it: white a gym, white and black a gym
// with a pool, blue a lagoon, and so on. The colours are F5's `mapRing`
// (src/theme/colors.ts); the drawing is `VenueRing`
// (src/features/explore/map/VenueRing.tsx); the words are the generated iOS
// keys `map.type.<type>.short|long` and `map.type.coming_soon`.
//
// Also here, because the card under a pinned pin needs them: the legend's
// list (only the types on the map, in the scheme's order, coming soon last)
// and the card's one English sentence (`shortSummary`).
import { lookup, type Lang } from '../i18n';
import type { MapRingType } from '../theme';
import type { Venue } from '../types/venue';
import { deriveOfferings } from './venueOfferings';

/** A venue type a ring can say. The same names the server's `markerType` uses. */
export type VenueMarkerType = MapRingType;

/** Every type, in the scheme's (and the legend's) order. */
export const VENUE_MARKER_TYPES: readonly VenueMarkerType[] = [
  'gym',
  'gymPool',
  'pool',
  'lagoon',
  'studio',
  'recovery',
  'racquet',
];

/**
 * A venue's ring: its type, and whether it is still coming soon (then drawn
 * as the dashed grey ring whatever the type).
 */
export interface Classification {
  readonly type: VenueMarkerType;
  readonly comingSoon: boolean;
}

/** A legend entry: a type, or the coming-soon modifier, which is listed last. */
export type LegendEntry = VenueMarkerType | 'comingSoon';

/** What the classifier reads (the parts of a `Venue` it needs, all optional). */
export interface MarkerInput {
  /** The singular access category ENUM (`Venue.primaryCategory`). */
  readonly primaryCategory?: string | null;
  /** The server's canonical offerings; null or absent when it sent none. */
  readonly offerings?: readonly string[] | null;
  /** The free-text display tags (`Venue.categories`). */
  readonly categories?: readonly string[] | null;
  readonly amenities?: readonly string[] | null;
  readonly name?: string | null;
  readonly awaitingConnection?: boolean | null;
  /** A ring type the server sent; a valid one overrides the app's own answer. */
  readonly serverMarkerType?: string | null;
}

// "& Pool", "+ pool", "and pool", "og pool" or "sundlaug" only: the name is a
// last resort, and "Poolside Yoga" is not a pool.
const POOL_NAME = /(?:&|\+|\band\b|\bog\b)\s*pool\b|sundlaug/iu;
// Lagoons are often named for their baths ("Vök Baths", "Jarðböðin").
const LAGOON_NAME = /lagoon|lón|baths|böð/iu;

function matches(pattern: RegExp, text: string | null | undefined): boolean {
  return typeof text === 'string' && pattern.test(text);
}

/** Whether a string is one of the types (the server's `markerType` is checked with it). */
export function isVenueMarkerType(value: unknown): value is VenueMarkerType {
  return typeof value === 'string' && (VENUE_MARKER_TYPES as readonly string[]).includes(value);
}

/**
 * The server's offerings, or the same derivation from the tags and amenities
 * when it sent none (an older server, an older cache).
 */
function offeringsOf(input: MarkerInput): ReadonlySet<string> {
  if (input.offerings) return new Set(input.offerings);
  return new Set(deriveOfferings(input.categories ?? [], input.amenities ?? []));
}

function poolIn(offerings: ReadonlySet<string>, name: string | null | undefined): boolean {
  return offerings.has('pool') || matches(POOL_NAME, name);
}

/** Whether the venue has a pool: a `pool` offering, or only failing that a name that says so. */
export function hasPoolSignal(input: MarkerInput): boolean {
  return poolIn(offeringsOf(input), input.name);
}

/**
 * The web's `classifyVenueMarker`. The category ENUM decides first, the
 * offerings after it; a valid `markerType` from the server, when one is ever
 * sent, overrides the local answer. Coming soon keeps the type (the legend
 * and the card still say it).
 */
export function classify(input: MarkerInput): Classification {
  const comingSoon = input.awaitingConnection === true;
  if (isVenueMarkerType(input.serverMarkerType)) {
    return { type: input.serverMarkerType, comingSoon };
  }
  let type: VenueMarkerType;
  switch (input.primaryCategory) {
    case 'lagoon':
      type = 'lagoon';
      break;
    case 'pool':
      type = 'pool';
      break;
    case 'gym':
      type = hasPoolSignal(input) ? 'gymPool' : 'gym';
      break;
    case 'studio':
    case 'boutique':
    case 'premium_studio':
      type = 'studio';
      break;
    case 'recovery':
      type = 'recovery';
      break;
    case 'racquet':
      type = 'racquet';
      break;
    default: {
      // No enum, or one this build does not know: the offerings decide, in
      // order. `recovery` is the vocabulary's umbrella.
      const offerings = offeringsOf(input);
      if (poolIn(offerings, input.name)) type = 'pool';
      else if (offerings.has('lagoon') || matches(LAGOON_NAME, input.name)) type = 'lagoon';
      else if (offerings.has('recovery')) type = 'recovery';
      else type = 'gym';
    }
  }
  return { type, comingSoon };
}

/** A venue's ring. */
export function classifyVenue(
  venue: Pick<
    Venue,
    'primaryCategory' | 'offerings' | 'categories' | 'amenities' | 'name' | 'awaitingConnection' | 'markerType'
  >,
): Classification {
  return classify({
    primaryCategory: venue.primaryCategory,
    offerings: venue.offerings,
    categories: venue.categories,
    amenities: venue.amenities,
    name: venue.name,
    awaitingConnection: venue.awaitingConnection,
    serverMarkerType: venue.markerType,
  });
}

/**
 * Every venue's ring, worked out once per load rather than once per pin per
 * frame (iOS `MapViewModel.classify`). The first of two venues with one id
 * wins.
 */
export function classifyAll(venues: readonly Venue[]): ReadonlyMap<string, Classification> {
  const rings = new Map<string, Classification>();
  for (const venue of venues) {
    if (!rings.has(venue.id)) rings.set(venue.id, classifyVenue(venue));
  }
  return rings;
}

// MARK: - Words

const KEY_PART: Readonly<Record<VenueMarkerType, string>> = {
  gym: 'gym',
  gymPool: 'gym_pool',
  pool: 'pool',
  lagoon: 'lagoon',
  studio: 'studio',
  recovery: 'recovery',
  racquet: 'racquet',
};

/** `map.type.<type>.short`: the legend's word. */
export function shortKey(type: VenueMarkerType): string {
  return `map.type.${KEY_PART[type]}.short`;
}

/** `map.type.<type>.long`: the card's type line and a pin's spoken name. */
export function longKey(type: VenueMarkerType): string {
  return `map.type.${KEY_PART[type]}.long`;
}

/** "Coming soon" / "Væntanlegt". */
export const COMING_SOON_KEY = 'map.type.coming_soon';

export function shortLabel(type: VenueMarkerType, language: Lang): string {
  return lookup(shortKey(type), language);
}

export function longLabel(type: VenueMarkerType, language: Lang): string {
  return lookup(longKey(type), language);
}

/** The legend's word for an entry: the type's short word, or "Coming soon". */
export function legendLabel(entry: LegendEntry, language: Lang): string {
  return entry === 'comingSoon' ? lookup(COMING_SOON_KEY, language) : shortLabel(entry, language);
}

/**
 * A pin's accessible name: "{name}, {long type}", plus ", coming soon" while
 * the venue awaits connection (the web's `venuePinLabel`): the type is said,
 * not only drawn.
 */
export function accessibilityLabel(type: VenueMarkerType, name: string, comingSoon: boolean, language: Lang): string {
  const soon = comingSoon ? `, ${lookup(COMING_SOON_KEY, language).toLowerCase()}` : '';
  return `${name}, ${longLabel(type, language)}${soon}`;
}

/**
 * The legend's list for the venues actually on the map: only the types
 * present, in the scheme's order, coming soon last. A coming-soon venue
 * counts only as coming soon: its pin draws the dashed ring, not its type's,
 * so its type alone would promise a ring the map does not show.
 */
export function legendEntries(classes: Iterable<Classification>): LegendEntry[] {
  const present = new Set<LegendEntry>();
  for (const item of classes) present.add(item.comingSoon ? 'comingSoon' : item.type);
  return [...VENUE_MARKER_TYPES, 'comingSoon' as const].filter((entry) => present.has(entry));
}

// MARK: - The card's one line

// A sentence ends at . ! or ? followed by the end, or by a space and a
// capital (or an opening quote or bracket). "est. 2015" does not end one.
const SENTENCE_END = /[.!?](?=\s*$|\s+["“'(A-ZÁÐÉÍÓÚÝÞÆÖ])/;
const TRAILING_CLIP = /[\s,;:.!?\-–—(]+$/;

/**
 * The web's `shortSummary`: the first sentence of a description when it fits
 * in `max` characters, else the description clipped at a word with an
 * ellipsis, never longer than `max`. Empty for no description. Characters are
 * counted as code points (iOS counts characters; the two agree on every
 * letter Icelandic and English use).
 */
export function shortSummary(description: string | null | undefined, max = 110): string {
  if (description == null) return '';
  const text = description.split(/\s+/).filter((word) => word !== '').join(' ');
  if (text === '') return '';

  let first = text;
  const end = SENTENCE_END.exec(text);
  if (end) first = text.slice(0, end.index + 1);
  if (Array.from(first).length <= max) return first;

  const room = Array.from(text)
    .slice(0, max - 1)
    .join('');
  let clipped = room;
  const roomChars = Array.from(room);
  const lastSpace = roomChars.lastIndexOf(' ');
  if (lastSpace >= 0 && lastSpace > Math.floor(max / 2)) {
    clipped = roomChars.slice(0, lastSpace).join('');
  }
  clipped = clipped.replace(TRAILING_CLIP, '');
  return `${clipped}…`;
}
