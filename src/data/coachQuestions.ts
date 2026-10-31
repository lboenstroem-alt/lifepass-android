/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Coach's venue wizard: its question sets, the location chips and the
 * region boxes, the narrower-category override, and which venue type a
 * message names. The Android port of iOS Models/CoachQuestions.swift.
 *
 * The questions are fixed. Only what the member reads is translated (each
 * `label` and `text` comes through `t`, from the generated `coach.q.*`,
 * `coach.opt.*`, `coach.loc.*` and `coach.other.label` keys); every `value`
 * stays an internal English key, so `coachCategoryOverride`,
 * `coachLocationFilter` and the venue query read the same values in both
 * languages. Values are never shown, and never sent to the model: a venue
 * search runs entirely through this wizard and `GET /venues`.
 *
 * Which TYPED words open the wizard, and which go to the chat, is decided in
 * src/features/coach/routing (`venueWizardCategory`): `detectVenueCategory`
 * here only says which venue type the words name.
 */
import { distanceMeters, REYKJAVIK_CENTRE, coordinateOf, type Coordinate, type MaybeLocated } from '../lib/geo';
import type { QuestionOption } from '../types/coach';

/** A question bubble: what it asks and its chips (iOS `QuestionDef`). */
export interface QuestionDef {
  readonly text: string;
  readonly options: readonly QuestionOption[];
}

/** A translator for the member's language (iOS passes `CoachViewModel.translate`). */
export type Translate = (key: string) => string;

/**
 * The venue wizard's categories, the keys of `venueQuestions` (iOS uses the
 * same strings). The same set as the Coach flows' `CoachWizardCategory`.
 */
export type VenueCategory = 'gym' | 'lagoon' | 'yoga' | 'swimming' | 'spa' | 'golf';

export const VENUE_CATEGORIES: readonly VenueCategory[] = ['gym', 'lagoon', 'yoga', 'swimming', 'spa', 'golf'];

// ─── Shared location chips (a question in every category) ─────────────────────

/**
 * The location chips' values: internal keys read by `coachLocationFilter`,
 * never shown (the chip shows its `label`). iOS `LocationValue`.
 */
export const LocationValue = {
  /** "15-min drive": measured on the phone from the member's position (see `applyLocationFilter`). */
  drive: 'drive15',
  /** Greater Reykjavík and the Reykjanes peninsula. */
  capital: 'capital',
  south: 'south',
  north: 'north',
  east: 'east',
  west: 'west',
} as const;

/** The location chips, labelled in the member's language (iOS `locationOptions`). */
export function locationOptions(t: Translate): QuestionOption[] {
  return [
    { label: t('coach.loc.drive'), value: LocationValue.drive },
    { label: t('coach.loc.capital'), value: LocationValue.capital },
    { label: t('coach.loc.south'), value: LocationValue.south },
    { label: t('coach.loc.north'), value: LocationValue.north },
    { label: t('coach.loc.east'), value: LocationValue.east },
    { label: t('coach.loc.west'), value: LocationValue.west },
  ];
}

function locationQuestion(t: Translate): QuestionDef {
  return { text: t('coach.q.location'), options: locationOptions(t) };
}

// ─── Location filtering (by coordinates) ──────────────────────────────────────
//
// The "Where in Iceland?" answer becomes a CoachLocationFilter, applied to the
// venues `GET /venues` returns. Regions come from each venue's latitude and
// longitude, not its `city` (too inconsistent to bucket: postcode prefixes,
// spelling variants), so a new venue is placed with no region list to keep.

export type IcelandRegion = 'capital' | 'south' | 'north' | 'east' | 'west';

/**
 * The chip region a coordinate falls in (iOS `icelandRegion(lat:lon:)`).
 * Greater Reykjavík and Reykjanes are `capital`; the rest of the country
 * splits roughly by direction. The boxes are deliberately coarse: they only
 * have to tell Akureyri (north), the eastfjords (east), Borgarnes, Akranes
 * and Snæfellsnes (west) and the south coast (south) from the capital area.
 */
export function icelandRegion(lat: number, lon: number): IcelandRegion {
  // Greater Reykjavík and Reykjanes (Keflavík, Njarðvík): the southwest corner.
  if (lat >= 63.78 && lat <= 64.25 && lon >= -22.8 && lon <= -21.55) return 'capital';
  // The eastfjords: Egilsstaðir, Höfn.
  if (lon >= -16.5) return 'east';
  // Akureyri and the north coast.
  if (lat >= 65.0 && lon >= -19.5) return 'north';
  // West must be NORTH of the capital box (lat 64.25 and up). Without that
  // gate, south-coast venues just east of greater Reykjavík (longitude -21.55
  // to -21.0, e.g. Selfoss and Hella at about 63.9N) would read as west and
  // drop out of the "South Iceland" chip.
  if (lat >= 64.25 && lon <= -21.0) return 'west';
  // Selfoss, Hella, Vík, Vestmannaeyjar.
  return 'south';
}

export type CoachLocationFilter =
  /** "15-min drive": distance from the member. */
  | { readonly kind: 'nearbyDrive' }
  | { readonly kind: 'region'; readonly region: IcelandRegion }
  | { readonly kind: 'none' };

/**
 * The location filter in the wizard's answers (iOS `coachLocationFilter`).
 * The location chip sits at a different step per category, so the answers
 * are scanned for a known value rather than read at a position. `none` when
 * the member never picked one (or typed their own answer to it).
 */
export function coachLocationFilter(answers: readonly string[]): CoachLocationFilter {
  for (const answer of answers) {
    switch (answer) {
      case LocationValue.drive:
        return { kind: 'nearbyDrive' };
      case LocationValue.capital:
        return { kind: 'region', region: 'capital' };
      case LocationValue.south:
        return { kind: 'region', region: 'south' };
      case LocationValue.north:
        return { kind: 'region', region: 'north' };
      case LocationValue.east:
        return { kind: 'region', region: 'east' };
      case LocationValue.west:
        return { kind: 'region', region: 'west' };
      default:
        continue;
    }
  }
  return { kind: 'none' };
}

/**
 * How far "15-min drive" reaches, in a straight line from the member: 15 km.
 *
 * iOS asks MapKit for a routed driving time to the 20 nearest venues and
 * keeps those within 15 minutes. When routing is unavailable it falls back to
 * exactly this: a 15 km straight line, ranked by straight-line distance (the
 * radius the first straight-line filter used). Android always takes that
 * path (owner decision D11): a directions service would need the member's
 * position, and the privacy policy promises the phone measures and LifePass
 * never receives it. Most venues are in the capital area, where 15 km is
 * about a 15-minute drive.
 */
export const DRIVE_RADIUS_METRES = 15_000;

/** The sentence that replaces the "Found N..." intro, when the drive filter needs one. */
export type LocationNoteKey = 'coach.note.no_location' | 'coach.note.nothing_nearby';

export interface LocationFilterResult<V> {
  readonly venues: V[];
  /** Shown instead of the "Found N..." intro when set. */
  readonly noteKey: LocationNoteKey | null;
}

/**
 * The venues the location answer allows, in the order to show them (iOS
 * `CoachViewModel.applyLocationFilter`):
 *  - `none`: the list as the API sent it;
 *  - a region: the venues whose coordinates fall in it, in the API's order;
 *  - "15-min drive": the venues within `DRIVE_RADIUS_METRES` of `fix`,
 *    nearest first. Without a fix (location off, or none yet) the distance is
 *    measured from Reykjavík centre and the note says so; with nothing in
 *    range, the closest are shown with a note saying so.
 * A venue with no coordinates cannot be placed: it drops out of both the
 * region and the distance branches.
 *
 * `fix` is the phone's last position, or null (iOS reads
 * `LocationService.currentLocation`, then falls back to Reykjavík centre).
 */
export function applyLocationFilter<V extends MaybeLocated>(
  venues: readonly V[],
  filter: CoachLocationFilter,
  fix: Coordinate | null,
): LocationFilterResult<V> {
  switch (filter.kind) {
    case 'none':
      return { venues: [...venues], noteKey: null };

    case 'region':
      return {
        venues: venues.filter((venue) => {
          const at = coordinateOf(venue);
          return at !== null && icelandRegion(at.latitude, at.longitude) === filter.region;
        }),
        noteKey: null,
      };

    case 'nearbyDrive': {
      // Without a real fix, "near you" is really "near Reykjavík": the note
      // says so rather than implying the list is close to the member.
      const hasFix = fix !== null;
      const origin = fix ?? REYKJAVIK_CENTRE;
      const byStraightLine = venues
        .map((venue) => {
          const at = coordinateOf(venue);
          return at === null ? null : { venue, metres: distanceMeters(origin, at) };
        })
        .filter((entry): entry is { venue: V; metres: number } => entry !== null)
        .sort((a, b) => a.metres - b.metres);
      const ranked = byStraightLine.map((entry) => entry.venue);
      const within = byStraightLine.filter((entry) => entry.metres <= DRIVE_RADIUS_METRES).map((entry) => entry.venue);

      if (!hasFix) {
        // Measured from Reykjavík centre: the in-range set when there is one
        // (most venues are in the capital), else the closest.
        const pool = within.length > 0 ? within : ranked;
        return { venues: pool, noteKey: pool.length > 0 ? 'coach.note.no_location' : null };
      }
      if (within.length === 0) {
        // Nothing in range: the closest instead of an empty answer, and say so.
        return { venues: ranked, noteKey: ranked.length > 0 ? 'coach.note.nothing_nearby' : null };
      }
      return { venues: within, noteKey: null };
    }
  }
}

// ─── A training type narrows the category ─────────────────────────────────────
//
// Some "what type?" chips map to a narrower database category than the broad
// one, so the right venue surfaces instead of the whole list: "MMA & Combat"
// queries "MMA" (the only way the MMA venue is found). Only types that exist
// as real venue tags are mapped; weightlifting, spinning and CrossFit have no
// tag of their own and fall through to the broad category.

/**
 * The narrower category the answers ask for, or null (iOS
 * `coachCategoryOverride`). Keep the cases in step with the chip values in
 * `venueQuestions`.
 */
export function coachCategoryOverride(answers: readonly string[]): string | null {
  for (const answer of answers) {
    switch (answer) {
      case 'MMA and combat sports':
        return 'MMA';
      // The gym set's "Pilates" chip and the yoga set's "Pilates reformer"
      // chip both mean Pilates studios: a reformer is a Pilates apparatus.
      case 'pilates':
      case 'pilates reformer':
        return 'Pilates';
      default:
        continue;
    }
  }
  return null;
}

/**
 * The one database category `GET /venues` filters on for a wizard category
 * (iOS `CoachViewModel.apiCategory`). The API matches it, ignoring case,
 * against each venue's `categories`.
 */
export function apiCategory(category: string): string {
  switch (category) {
    case 'gym':
      return 'Gym';
    case 'lagoon':
      return 'Lagoon';
    case 'yoga':
      return 'Yoga';
    case 'swimming':
      return 'Pool';
    case 'spa':
      return 'Spa';
    case 'golf':
      return 'Golf';
    default:
      return category;
  }
}

/**
 * The word a member reads for a category in the wizard's sentences ("Found 3
 * swimming options"), distinct from `apiCategory` (the database's "Pool"), so
 * a sentence never echoes an internal key (iOS `displayCategoryName`).
 */
export function displayCategoryName(category: string, t: Translate): string {
  switch (category) {
    case 'gym':
      return t('coach.cat_name.gym');
    case 'lagoon':
      return t('coach.cat_name.lagoon');
    case 'yoga':
      return t('coach.cat_name.yoga');
    case 'swimming':
      return t('coach.cat_name.swimming');
    case 'spa':
      return t('coach.cat_name.spa');
    case 'golf':
      return t('coach.cat_name.golf');
    default:
      return category;
  }
}

// ─── The question sets ────────────────────────────────────────────────────────

/** The wizard's questions per category, in the member's language (iOS `venueQuestions`). */
export function venueQuestions(t: Translate): Readonly<Record<VenueCategory, readonly QuestionDef[]>> {
  return {
    gym: [
      {
        text: t('coach.q.gym.type'),
        options: [
          { label: t('coach.opt.gym.weightlifting'), value: 'weightlifting' },
          { label: t('coach.opt.gym.mma'), value: 'MMA and combat sports' },
          { label: t('coach.opt.gym.spinning'), value: 'spinning classes' },
          { label: t('coach.opt.gym.crossfit'), value: 'CrossFit' },
          { label: t('coach.opt.gym.pilates'), value: 'pilates' },
          { label: t('coach.other.label'), value: '', isOther: true },
        ],
      },
      locationQuestion(t),
      {
        text: t('coach.q.gym.amenities'),
        options: [
          { label: t('coach.opt.gym.sauna'), value: 'with a sauna' },
          { label: t('coach.opt.gym.evenings'), value: 'open in the evening' },
          { label: t('coach.opt.gym.no_pref'), value: '' },
        ],
      },
    ],

    lagoon: [
      {
        text: t('coach.q.lagoon.experience'),
        options: [
          { label: t('coach.opt.lagoon.geothermal'), value: 'geothermal pools' },
          { label: t('coach.opt.lagoon.cold_plunge'), value: 'sauna and cold plunge' },
          { label: t('coach.opt.lagoon.luxury_spa'), value: 'luxury spa experience' },
        ],
      },
      locationQuestion(t),
    ],

    yoga: [
      {
        text: t('coach.q.yoga.style'),
        options: [
          { label: t('coach.opt.yoga.vinyasa'), value: 'vinyasa flow yoga' },
          { label: t('coach.opt.yoga.yin'), value: 'yin and restorative yoga' },
          { label: t('coach.opt.yoga.reformer'), value: 'pilates reformer' },
          { label: t('coach.opt.yoga.hot'), value: 'hot yoga' },
          { label: t('coach.other.label'), value: '', isOther: true },
        ],
      },
      locationQuestion(t),
      {
        text: t('coach.q.yoga.level'),
        options: [
          { label: t('coach.opt.yoga.beginner'), value: 'suitable for beginners' },
          { label: t('coach.opt.yoga.intermediate'), value: 'intermediate level' },
          { label: t('coach.opt.yoga.advanced'), value: 'advanced level' },
          { label: t('coach.opt.yoga.any_level'), value: '' },
        ],
      },
    ],

    swimming: [
      {
        text: t('coach.q.swimming.after'),
        options: [
          { label: t('coach.opt.swimming.laps'), value: 'lap swimming lanes' },
          { label: t('coach.opt.swimming.hot_tubs'), value: 'hot tubs and relaxation' },
          { label: t('coach.opt.swimming.outdoor'), value: 'outdoor heated pool' },
          { label: t('coach.opt.swimming.family'), value: 'family-friendly facilities' },
        ],
      },
      locationQuestion(t),
      {
        text: t('coach.q.swimming.extras'),
        options: [
          { label: t('coach.opt.swimming.steam'), value: 'with a steam room' },
          { label: t('coach.opt.swimming.sauna'), value: 'with a sauna' },
          { label: t('coach.opt.swimming.early'), value: 'open early in the morning' },
          { label: t('coach.opt.swimming.no_pref'), value: '' },
        ],
      },
    ],

    spa: [
      {
        text: t('coach.q.spa.type'),
        options: [
          { label: t('coach.opt.spa.traditional'), value: 'traditional sauna' },
          { label: t('coach.opt.spa.steam'), value: 'steam room' },
          { label: t('coach.opt.spa.full'), value: 'full spa treatment' },
          { label: t('coach.opt.spa.combo'), value: 'sauna and pool combination' },
          { label: t('coach.other.label'), value: '', isOther: true },
        ],
      },
      locationQuestion(t),
    ],

    // One golf venue today (in the South), and golf has no sub-types worth
    // filtering on: only the shared location question, no decorative chips
    // that narrow nothing. Location filtering starts to matter as courses
    // are added.
    golf: [locationQuestion(t)],
  };
}

/** True for a key `venueQuestions` serves. */
export function isVenueCategory(value: string): value is VenueCategory {
  return (VENUE_CATEGORIES as readonly string[]).includes(value);
}

// ─── Which venue type the words name ──────────────────────────────────────────

/**
 * NSRegularExpression's word characters (ICU `\w`): letters in any script,
 * combining marks, decimal digits and connector punctuation. JavaScript's
 * `\b` knows only ASCII letters, so it would see a boundary between "mma"
 * and an Icelandic letter after it where iOS sees none; the iOS boundaries
 * are spelled out below instead.
 */
const WORD_CHARACTER = '\\p{L}\\p{M}\\p{Nd}\\p{Pc}';
/** iOS `\b` in front of a word: the start, or a character that is not a word character. */
const WORD_START = `(?:^|[^${WORD_CHARACTER}])`;
/** iOS `\b` after a word. */
const WORD_END = `(?![${WORD_CHARACTER}])`;

function word(term: string): string {
  return `${WORD_START}${term}${WORD_END}`;
}

/**
 * The categories in the order they are tried. ORDER MATTERS (iOS):
 * - gym first ("workout", "fitness", "spinning" all mean a gym);
 * - yoga and swimming before spa, so "wellness day with yoga" opens the yoga
 *   wizard and "sauna and swimming" the swimming wizard;
 * - spa before lagoon, so a prompt naming both (the "Spa & Lagoons" card,
 *   "a spa or lagoon evening") opens the spa wizard, as that card's own
 *   category does. A lagoon-only request never names a spa word.
 */
const CATEGORY_PATTERNS: readonly (readonly [VenueCategory, RegExp])[] = [
  ['gym', new RegExp(`${word('gym')}|gyms|workout|fitness|weightlift|crossfit|${word('mma')}|combat|spinning`, 'u')],
  ['yoga', new RegExp(`${word('yoga')}|pilates|vinyasa|yin yoga|hot yoga`, 'u')],
  ['swimming', new RegExp(`${word('pool')}|pools|swimming|swim lane`, 'u')],
  ['spa', new RegExp(`${word('spa')}|saunas?|steam room|wellness|recovery`, 'u')],
  ['lagoon', /lagoon|hot spring|geothermal|thermal pool/u],
  ['golf', new RegExp(`${word('golf')}|golfing|driving range`, 'u')],
];

/**
 * The venue type a message names, or null (iOS `detectVenueCategory`). Says
 * only what the words name; whether TYPED words open the wizard is
 * `venueWizardCategory` (src/features/coach/routing/scheduleCue.ts), which
 * sends a question about classes or a time to the chat instead. The day-plan
 * intent reads this too ("plan my day tomorrow with yoga").
 */
export function detectVenueCategory(text: string): VenueCategory | null {
  const lowered = text.toLowerCase();
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(lowered)) return category;
  }
  return null;
}
