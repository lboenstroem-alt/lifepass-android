// LifePass colour tokens: the "Nordic Editorial" palette of iOS 2.5.6
// (LifePassTheme.swift), value for value.
//
//   Paper        #F8F6F1  warm off-white, page base and surfaces
//   Ink          #191C24  near-black, primary text and headings
//   Glacier Blue #4785C2  interactive elements, CTAs, brand highlights
//   Rule         #D8D3CB  warm hairline borders
//
// THE NAMES ARE HISTORICALLY INVERTED, exactly as on iOS, so a Swift view
// ports token for token:
//   - `ink*`   are SURFACES (page base, cards): light warm paper.
//   - `paper*` is TEXT / foreground: dark ink.
//   - `rust*`  is the primary ACCENT: glacier blue (a legacy name).
// Read `ink` as "the ink-drawn page" and `paper` as "the paper you print type
// on" if the names trip you up.
//
// The app is light only (app.json `userInterfaceStyle: "light"`, iOS
// `preferredColorScheme(.light)`), so there are no dark pairs.
//
// Older Android names are kept as aliases (`blue` = `rust`, `blueMid` =
// `rust2`, `blueWash` = `rust3`, `skyBlue` = `signal`) so legacy screens pick
// up the iOS values without a rename; new code uses the iOS names.

/** iOS lpPaper (#191C24) at an opacity, the way SwiftUI draws lpPaper2..4. */
const inkText = (opacity: number) => `rgba(25,28,36,${opacity})`;

/** iOS lpRust (#4785C2) at an opacity. */
const glacier = (opacity: number) => `rgba(71,133,194,${opacity})`;

export const colors = {
  // ─── Surfaces (warm paper) ───────────────────────────────────────
  /** Page base. iOS lpInk. */
  ink: '#F8F6F1',
  /** Raised surface: cards, sheets, fields. iOS lpInk2. */
  ink2: '#F2EFE8',
  /** Elevated surface, image placeholders, skeletons. iOS lpInk3. */
  ink3: '#E7E3DA',
  /** Inner surfaces, tag chips. iOS lpInk4. */
  ink4: '#E0DBD1',
  /** Hairline borders: a SOLID warm rule, not a translucent ink. iOS lpLine. */
  line: '#D8D3CB',
  /** Stronger borders. iOS lpLine2. */
  line2: '#C4BFB5',

  // ─── Text (deep ink) ─────────────────────────────────────────────
  paper: '#191C24',
  paper2: inkText(0.72),
  paper3: inkText(0.48),
  paper4: inkText(0.28),

  // ─── Accents ─────────────────────────────────────────────────────
  /** Glacier blue, the primary brand action. iOS lpRust. */
  rust: '#4785C2',
  /** Lighter glacier for pressed states and highlights. iOS lpRust2. */
  rust2: '#699ED4',
  /** Glacier wash behind soft buttons and chips. iOS lpRust3 (14 %). */
  rust3: glacier(0.14),
  /** Calm tertiary, decorative dot markers. iOS lpAurora (= lpRust). */
  aurora: '#4785C2',
  /**
   * "Included / confirmed / available" markers. Formerly a green; per brand
   * direction it is the ink, so it reads as a neutral tag. iOS lpMoss.
   */
  moss: '#191C24',
  /** Premium accent: editorial kickers, premium price pills. iOS lpSignal. */
  signal: '#2A4D6F',
  /**
   * Public sights and hiking routes we point at but do not sell. Never a
   * venue colour: on a map that shows both, a visitor must tell at a glance
   * which pins their pass opens (a test holds `mapRing` apart from these).
   * iOS lpAttraction / lpAttraction2, the web's MAP_ATTRACTION.
   */
  attraction: '#4EA8DE',
  attraction2: '#2C7DA0',
  /** Safety-critical red; reads on warm paper. iOS lpDestructive. */
  destructive: '#D02525',

  // ─── Readable-contrast tokens (iOS 2.5.4, WCAG AA) ───────────────
  // Where the global tokens fall short of 4.5:1 on paper (theme/contrast.ts
  // and its test measure them):
  //   paper3 text     3.0 to 3.1:1 → mutedTextStrong 6.0 to 6.5:1
  //   #4785C2 text    3.4 to 3.6:1 → accentText      4.8 to 5.6:1
  //   white on rust   3.9:1        → actionFill      6.0:1
  /** Secondary text that has to be read: meta lines, notes, sub-lines. */
  mutedTextStrong: inkText(0.72),
  /** Accent-coloured TEXT and icons on paper (links, "See other times"). */
  accentText: '#2F6699',
  /** The fill behind white button text in the booking flows and venue bar. */
  actionFill: '#2F6699',

  /** Text and icons on an accent or destructive fill. */
  onAccent: '#FFFFFF',

  // ─── Legacy Android names (aliases of the iOS tokens above) ──────
  /** = rust. */
  blue: '#4785C2',
  /** = rust2. */
  blueMid: '#699ED4',
  /** = rust3. */
  blueWash: glacier(0.14),
  /** = signal ("signal / luxury accents, deep glacier"). */
  skyBlue: '#2A4D6F',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * The ring around a venue's photo pin on the Explore map says what kind of
 * place it is (iOS `MapRing`, 2.5.5). The hue says it once and the ring's FORM
 * says it again (solid, split, double, framed, dashed), so a reader who cannot
 * tell the hues apart still can.
 *
 * Literal values copied from the web's apps/web/src/lib/map-colors.ts
 * (MAP_RING_*): change both or the phone and the laptop disagree. NONE may
 * equal `colors.attraction` or `colors.attraction2`: a recommendation must
 * never look like a venue (src/theme/__tests__/colors.test.ts).
 */
export const mapRing = {
  /** Gym: snow, solid. */
  gym: '#FFFFFF',
  /** Pool: basalt, solid. Also the ink of the racquet frame and the pinned halo. */
  pool: '#191D24',
  /** Lagoon: a clear blue, darker than any sight blue. */
  lagoon: '#155E9E',
  /** Studio (and boutique, premium studio): lava, solid. */
  studio: '#B4532A',
  /** Spa and recovery: moss, drawn as a double ring. */
  recovery: '#5B7F4A',
  /** Racquet sports: aurora, framed with an ink hairline. */
  racquet: '#6E56A8',
  /** Coming soon: grey dashes over a greyscale photo. */
  soon: '#8A8F98',
  /** = pool: the frame and halo ink. */
  ink: '#191D24',
  /** White hairline inside the black band of pool and gym + pool, for dark photos. */
  innerHairline: 'rgba(255,255,255,0.7)',
  /** Outer hairline every pin keeps: holds the white ring at about 3:1 on the light map. */
  outerHairline: 'rgba(25,29,36,0.55)',
  /** The grey photo stand-in of the legend and card swatches. */
  swatchFill: '#6B7280',
} as const;

/** The venue types a ring distinguishes (iOS `VenueMarkerType`). */
export type MapRingType = 'gym' | 'gymPool' | 'pool' | 'lagoon' | 'studio' | 'recovery' | 'racquet';

/** The ring colour of a venue type (iOS `MapRing.hex(for:)`); gym + pool leads with snow. */
export function mapRingHex(type: MapRingType): string {
  switch (type) {
    case 'gym':
    case 'gymPool':
      return mapRing.gym;
    case 'pool':
      return mapRing.pool;
    case 'lagoon':
      return mapRing.lagoon;
    case 'studio':
      return mapRing.studio;
    case 'recovery':
      return mapRing.recovery;
    case 'racquet':
      return mapRing.racquet;
  }
}
