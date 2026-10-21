// The web's shared offerings vocabulary, the half the Explore map's venue
// ring needs: the Android port of iOS `VenueOfferings`
// (Models/CategoryMapping.swift), itself a port of the web's
// apps/web/src/lib/venue-offerings.ts.
//
// `deriveOfferings` turns a venue's free-text tags and amenities into the
// canonical keys ("pool", "lagoon", "recovery", ...) the way the server does
// for `VenueSummary.offerings`. The ring reads the server's own list; this is
// only used when the server sent none (an older server, an older cache), so
// such a venue still wears the same ring (src/lib/venueMarkerType.ts).
//
// The tables below are copied value for value from iOS (which generated
// them from the web vocabulary). When the web vocabulary changes, iOS
// regenerates and this file follows; never edit a row by hand. The test that
// derives every live venue's offerings from its tags says when the two have
// drifted (src/lib/__tests__/venueMarkerType.test.ts).

/** One canonical offering: its key, what it implies, its exact raw values and its synonyms. */
interface Concept {
  readonly key: string;
  readonly implies: readonly string[];
  readonly raw: readonly string[];
  readonly synonyms: readonly string[];
}

/**
 * Text as it is compared: lower case, Icelandic letters folded as a keyboard
 * without them types them (þ th, ð d, æ ae, ø o, accents dropped), runs of
 * anything else one space, and a lone "s" (a possessive) dropped.
 */
export function fold(value: string): string {
  const lowered = value.toLowerCase().replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae').replace(/ø/g, 'o');
  let out = '';
  for (const char of lowered.normalize('NFD')) {
    const code = char.codePointAt(0) ?? 0;
    // Combining marks: the accent of a decomposed letter.
    if (code >= 0x300 && code <= 0x36f) continue;
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) out += char;
    else out += ' ';
  }
  return out
    .split(' ')
    .filter((word) => word !== '' && word !== 's')
    .join(' ');
}

/** A token's singular, roughly: "saunas" sauna, "boxes" box; "class" and short words stay. */
export function stripPlural(token: string): string {
  if (Array.from(token).length <= 3) return token;
  if (token.endsWith('ses') || token.endsWith('xes') || token.endsWith('shes') || token.endsWith('ches')) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** One alternative of a pattern word: an exact stem, or a prefix (written `stem*`). */
interface Alt {
  readonly stem: string;
  readonly prefix: boolean;
}

/** A phrase pattern: each word a set of alternatives, and the keys it gives. */
interface Pattern {
  readonly words: readonly (readonly Alt[])[];
  readonly keys: readonly string[];
}

function compile(source: string, keys: readonly string[]): Pattern {
  return {
    words: source.split(' ').map((word) =>
      word.split('|').map((alt) => (alt.endsWith('*') ? { stem: alt.slice(0, -1), prefix: true } : { stem: alt, prefix: false })),
    ),
    keys,
  };
}

// GENERATED (on iOS) from apps/web/src/lib/venue-offerings.ts (monorepo
// origin/main 98fe5d2d): CONCEPTS, AMBIGUOUS, IGNORED_RAW, RAW_OVERRIDES,
// BRAND_PHRASES and RECOVERY_SOURCES, copied value for value.
const concepts: readonly Concept[] = [
  { key: 'sauna', implies: [], raw: ['Dry Sauna'], synonyms: ['sauna*', 'saunu*', 'sana*', 'sanu', 'gufubad*', 'gufubod*', 'thurrgufa*', 'thurrgufu*', 'dry sauna*', 'finnish sauna*', 'wood fired sauna*', 'aufguss', 'gusa*', 'gusu*'] },
  { key: 'infrared-sauna', implies: ['sauna'], raw: ['Infrared Sauna'], synonyms: ['infrared sauna*', 'ir sauna*', 'innraud* gufa*|gufu*|sana*|sauna*', 'innraudur hitaklefi'] },
  { key: 'steam-room', implies: [], raw: [], synonyms: ['steam*', 'steam room*', 'steam bath*', 'eimbad*', 'eimbod*', 'blautgufa*', 'blautgufu*', 'vatnsgufa*', 'hammam', 'turkish bath*'] },
  { key: 'hot-tub', implies: [], raw: [], synonyms: ['hot tub*', 'hot pot*', 'jacuzzi*', 'whirlpool*', 'heit* pott*', 'nuddpott*', 'massage tub*'] },
  { key: 'cold-plunge', implies: [], raw: [], synonyms: ['cold plunge*', 'cold tub*', 'cold pool*', 'cold bath*', 'ice bath*', 'plunge*', 'kald*|kold* pott*', 'kaldipott*', 'kalt kar', 'isbad*', 'kuldi'] },
  { key: 'pool', implies: [], raw: [], synonyms: ['pool*', 'swimming pool*', 'swim*', 'sundlaug*', 'sund', 'sundi', 'sundhol*', 'synda', 'laug', 'laugin', 'laugina', 'lauginni'] },
  { key: 'kids-pool', implies: ['pool'], raw: [], synonyms: ['kid*|child* pool*', 'wading pool*', 'splash pool*', 'barnalaug*', 'vadlaug*', 'leiklaug*'] },
  { key: 'water-slide', implies: [], raw: [], synonyms: ['water slide*', 'waterslide*', 'slide*', 'rennibraut*', 'vatnsrennibraut*'] },
  { key: 'lagoon', implies: [], raw: ['Lagoon', 'Hot Spring', 'Hot Springs'], synonyms: ['lagoon*', 'hot spring*', 'geothermal', 'jardhit*', 'natturulaug*', 'lon', 'loni', 'lonid', 'lonin', 'loninu', 'lonum', 'lonsins'] },
  { key: 'hot-room', implies: [], raw: [], synonyms: ['hot room*', 'heated room*|studio*', 'heit* sal*', 'hotfit', 'hot fit', 'hot class*'] },
  { key: 'infrared-room', implies: ['hot-room'], raw: ['Infrared Room'], synonyms: ['infrared room*|studio*|class*', 'innraud* sal*'] },
  { key: 'gym-floor', implies: ['strength'], raw: ['Gym', 'Gym Equipment', 'Open gym', '24/7 gym access'], synonyms: ['gym', 'open gym', 'gym floor', 'weight room*', 'fitness', 'raekt*', 'likamsraekt*', 'taekjasal*'] },
  { key: 'strength', implies: [], raw: [], synonyms: ['strength*', 'strength training', 'styrk*', 'lyfting*', 'lyfta', 'kraftlyfting*', 'weightlift*', 'powerlift*', 'weight training', 'olympic lifting', 'oly', 'lifting'] },
  { key: 'free-weights', implies: ['strength'], raw: ['Free Weights', 'Plate Loaded'], synonyms: ['free weight*', 'dumbbell*', 'barbell*', 'kettlebell*', 'handlod*', 'ketilbjoll*', 'laus* lod*', 'plate loaded'] },
  { key: 'cardio', implies: [], raw: ['Cardio', 'Cardio Machines'], synonyms: ['cardio', 'cardio machine*', 'treadmill*', 'hlaupabrett*', 'tholthjalf*'] },
  { key: 'functional', implies: [], raw: ['Functional Training', 'Conditioning', 'SkillX'], synonyms: ['functional*', 'crossfit*', 'cross fit', 'wod', 'hyrox', 'conditioning', 'threk', 'hreysti*', 'skillx'] },
  { key: 'climbing', implies: [], raw: [], synonyms: ['climb*', 'boulder*', 'klifur*', 'klifra*', 'grjotglim*'] },
  { key: 'martial-arts', implies: [], raw: ['MMA'], synonyms: ['martial art*', 'mma', 'bjj', 'jiu jitsu', 'jiujitsu', 'kickbox*', 'sparkbox*', 'bardagaithrott*', 'judo', 'karate', 'taekwondo'] },
  { key: 'boxing', implies: ['martial-arts'], raw: [], synonyms: ['box', 'boxing', 'boxer*', 'hnefaleik*'] },
  { key: 'padel', implies: [], raw: [], synonyms: ['padel*'] },
  { key: 'tennis', implies: [], raw: [], synonyms: ['tennis*'] },
  { key: 'golf', implies: [], raw: [], synonyms: ['golf*', 'golfhermi*'] },
  { key: 'skating', implies: [], raw: [], synonyms: ['skate*', 'skating', 'ice skating', 'ice rink*', 'skaut*'] },
  { key: 'running', implies: [], raw: [], synonyms: ['running', 'runner*', 'hlaup', 'hlaupa', 'hlaupahop*'] },
  { key: 'group-classes', implies: [], raw: ['Group Classes', 'Group Training', 'coached group classes'], synonyms: ['class', 'group class', 'group training', 'group fitness', 'hoptim*', 'hopthjalf*', 'timar', 'timi'] },
  { key: 'yoga', implies: ['group-classes'], raw: [], synonyms: ['yoga*', 'joga*', 'yin', 'vinyasa', 'hatha', 'ashtanga', 'nidra'] },
  { key: 'hot-yoga', implies: ['yoga', 'group-classes'], raw: [], synonyms: ['hot yoga', 'heit* joga*|yoga*', 'bikram'] },
  { key: 'pilates', implies: ['group-classes'], raw: [], synonyms: ['pilates*', 'reformer*'] },
  { key: 'barre', implies: ['group-classes'], raw: [], synonyms: ['barre'] },
  { key: 'spinning', implies: ['group-classes'], raw: ['Spinning', 'Spinning Room', 'Spinning Studio', 'spinning bikes', 'Cycling'], synonyms: ['spin', 'spinn*', 'spins', 'indoor cycling', 'cycling', 'hjol', 'hjola', 'hjoli', 'hjolin', 'hjolum', 'hjolatim*', 'hjolasal*', 'hjolreid*'] },
  { key: 'hiit', implies: ['group-classes'], raw: ['Hiit'], synonyms: ['hiit', 'tabata', 'interval training', 'lotuthjalf*'] },
  { key: 'dance', implies: ['group-classes'], raw: [], synonyms: ['dance*', 'dans', 'dansa*', 'dansi', 'dansinn', 'dansins', 'danstim*', 'zumba'] },
  { key: 'meditation', implies: [], raw: ['Meditation', 'Mindfulness', 'Breathwork'], synonyms: ['meditat*', 'mindful*', 'breathwork', 'breath work', 'hugleidsl*', 'slokun*', 'ondun*'] },
  { key: 'mobility', implies: ['group-classes'], raw: ['Flexibility'], synonyms: ['mobility', 'stretch*', 'flexib*', 'lidleik*', 'teygj*'] },
  { key: 'spa', implies: [], raw: [], synonyms: ['spa', 'spas', 'heilsulind*'] },
  { key: 'massage', implies: [], raw: [], synonyms: ['massage*', 'nudd*'] },
  { key: 'chiropractic', implies: [], raw: ['Chiropractic', 'Chriropractic', 'Chiropractor'], synonyms: ['chiropract*', 'chriropract*', 'kiroprakt*'] },
  { key: 'physiotherapy', implies: [], raw: [], synonyms: ['physio*', 'sjukrathjalf*'] },
  { key: 'recovery', implies: [], raw: [], synonyms: ['recovery', 'endurheimt*'] },
];

const ambiguous: readonly { readonly pattern: string; readonly keys: readonly string[] }[] = [
  { pattern: 'gufa', keys: ['sauna', 'steam-room'] },
  { pattern: 'gufu', keys: ['sauna', 'steam-room'] },
  { pattern: 'gufan', keys: ['sauna', 'steam-room'] },
  { pattern: 'gufuna', keys: ['sauna', 'steam-room'] },
  { pattern: 'gufunni', keys: ['sauna', 'steam-room'] },
  { pattern: 'pott*', keys: ['hot-tub', 'cold-plunge'] },
  { pattern: 'infrared', keys: ['infrared-sauna', 'infrared-room'] },
  { pattern: 'innraud*', keys: ['infrared-sauna', 'infrared-room'] },
];

const ignoredRaw: readonly string[] = [
  'Fitness', 'Sports', 'Wellness', 'Recovery', 'Restorative', 'Bath', 'Towels', 'Towel', 'Changing rooms', 'Locker',
  'Lockers', 'Robes', 'Showers', 'Relaxation lounge', 'Supplement shop', 'Beginner-friendly scaling', 'Kids Corner',
  'DWC', 'WorldFit', 'Childcare', 'Women', 'Men', 'Morning', 'Flow', 'Creative', 'Mixed', 'Core', 'Toning',
  "Women's Health",
];

const rawOverrides: readonly { readonly raw: string; readonly keys: readonly string[] }[] = [
  { raw: 'Steam Sauna', keys: ['sauna'] },
  { raw: 'Infrared', keys: ['infrared-room'] },
  { raw: 'Hot Room', keys: ['hot-room'] },
  { raw: 'Hot Rooms', keys: ['hot-room'] },
];

const brandPhrases: readonly string[] = ['world class'];

const recoverySources: readonly string[] = ['sauna', 'steam-room', 'hot-tub', 'cold-plunge', 'lagoon', 'spa', 'massage'];

// MARK: - Compiled once

const patterns: readonly Pattern[] = [
  ...concepts.flatMap((concept) => concept.synonyms.map((synonym) => compile(synonym, [concept.key]))),
  ...ambiguous.map((entry) => compile(entry.pattern, entry.keys)),
];

const ignoredFolded = new Set(ignoredRaw.map(fold));

const rawExact: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const { raw, keys } of rawOverrides) map.set(fold(raw), keys);
  for (const concept of concepts) {
    for (const raw of concept.raw) {
      if (!map.has(fold(raw))) map.set(fold(raw), [concept.key]);
    }
  }
  return map;
})();

const impliesByKey: ReadonlyMap<string, readonly string[]> = new Map(concepts.map((concept) => [concept.key, concept.implies]));

const brandTokens: readonly (readonly string[])[] = brandPhrases.map((phrase) => phrase.split(' '));

function altMatches(alt: Alt, token: string): boolean {
  if (alt.prefix) return token.startsWith(alt.stem);
  return token === alt.stem || stripPlural(token) === stripPlural(alt.stem);
}

/** How specific a word's match is: an exact stem beats a prefix, a longer stem a shorter one. */
function specificity(word: readonly Alt[], token: string): number {
  let best = 0;
  for (const alt of word) {
    if (!altMatches(alt, token)) continue;
    const stemLength = Array.from(alt.stem).length;
    best = Math.max(best, alt.prefix ? stemLength : 100 + stemLength);
  }
  return best;
}

/** The phrase starting at `start`: longest first; equal length and specificity give every key. */
function bestMatch(tokens: readonly string[], start: number): { length: number; keys: string[] } | null {
  let bestLength = 0;
  let bestSpecificity = 0;
  let keys: string[] = [];
  for (const pattern of patterns) {
    const length = pattern.words.length;
    if (length === 0 || start + length > tokens.length) continue;
    let score = 0;
    let matched = true;
    for (let offset = 0; offset < length; offset += 1) {
      const word = pattern.words[offset];
      const token = tokens[start + offset];
      if (!word.some((alt) => altMatches(alt, token))) {
        matched = false;
        break;
      }
      score += specificity(word, token);
    }
    if (!matched) continue;
    if (keys.length === 0 || length > bestLength || (length === bestLength && score > bestSpecificity)) {
      bestLength = length;
      bestSpecificity = score;
      keys = [...pattern.keys];
    } else if (length === bestLength && score === bestSpecificity) {
      for (const key of pattern.keys) if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys.length === 0 ? null : { length: bestLength, keys };
}

/** How many tokens a brand name takes at `start` (it says nothing about offerings), or 0. */
function brandLength(tokens: readonly string[], start: number): number {
  for (const phrase of brandTokens) {
    if (start + phrase.length > tokens.length) continue;
    if (phrase.every((word, index) => tokens[start + index] === word)) return phrase.length;
  }
  return 0;
}

function rawValueKeys(value: string): string[] {
  const folded = fold(value);
  if (folded === '' || ignoredFolded.has(folded)) return [];
  const exact = rawExact.get(folded);
  if (exact) return [...exact];
  const tokens = folded.split(' ');
  const keys: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const brand = brandLength(tokens, index);
    if (brand > 0) {
      index += brand;
      continue;
    }
    const match = bestMatch(tokens, index);
    if (match) {
      keys.push(...match.keys);
      index += match.length;
    } else {
      index += 1;
    }
  }
  return keys;
}

/**
 * The canonical keys a venue offers: every tag and amenity through the
 * vocabulary, the `implies` closure and the `recovery` umbrella. Sorted.
 * `accessCategory` (the venue's access enum) adds `pool` or `lagoon` the way
 * the web's derivation does; the ring's own fallback passes none, as iOS.
 */
export function deriveOfferings(
  categories: readonly string[],
  amenities: readonly string[],
  accessCategory: string | null = null,
): string[] {
  const keys = new Set<string>();
  for (const value of [...categories, ...amenities]) {
    for (const key of rawValueKeys(value)) keys.add(key);
  }
  if (accessCategory === 'pool') keys.add('pool');
  if (accessCategory === 'lagoon') keys.add('lagoon');
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...keys]) {
      for (const parent of impliesByKey.get(key) ?? []) {
        if (!keys.has(parent)) {
          keys.add(parent);
          changed = true;
        }
      }
    }
  }
  if (recoverySources.some((source) => keys.has(source))) keys.add('recovery');
  return [...keys].sort();
}
