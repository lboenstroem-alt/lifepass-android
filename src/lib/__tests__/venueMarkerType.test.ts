/**
 * The venue rings on the Explore map (2.5.5): the same type for every venue
 * as the web map, the legend, the words and the card's one line. A port of
 * iOS VenueMarkerTypeTests, case for case and vector for vector. The live
 * feed is what the map actually draws, so the rule is held to it rather than
 * to hand-made examples alone.
 */
import { decodeVenue } from '../../api/venues';
import { lookup } from '../../i18n';
import { colors, mapRing, mapRingHex } from '../../theme';
import {
  accessibilityLabel,
  classify,
  classifyAll,
  classifyVenue,
  COMING_SOON_KEY,
  hasPoolSignal,
  legendEntries,
  legendLabel,
  shortLabel,
  shortSummary,
  VENUE_MARKER_TYPES,
  type MarkerInput,
  type VenueMarkerType,
} from '../venueMarkerType';
import { deriveOfferings, fold, stripPlural } from '../venueOfferings';
import { LIVE_RING_CASES } from './liveVenueRings';

function ringOf(item: (typeof LIVE_RING_CASES)[number], offerings: readonly string[] | null = item.offerings) {
  return classify({
    primaryCategory: item.primaryCategory,
    offerings,
    categories: item.categories,
    amenities: item.amenities,
    name: item.name,
    awaitingConnection: item.awaitingConnection,
  });
}

describe('(a) the live feed', () => {
  it('every live venue wears the web map’s ring', () => {
    expect(LIVE_RING_CASES).toHaveLength(45);
    const counts: Partial<Record<VenueMarkerType, number>> = {};
    let soon = 0;
    for (const item of LIVE_RING_CASES) {
      const ring = ringOf(item);
      expect({ slug: item.slug, type: ring.type }).toEqual({ slug: item.slug, type: item.expected });
      counts[ring.type] = (counts[ring.type] ?? 0) + 1;
      if (ring.comingSoon) soon += 1;
    }
    expect(counts).toEqual({ gym: 19, gymPool: 11, studio: 8, lagoon: 3, recovery: 3, pool: 1 });
    expect(soon).toBe(6);
  });

  it('an older server or a cached row with no offerings draws the same rings from the tags alone', () => {
    for (const item of LIVE_RING_CASES) {
      expect({ slug: item.slug, type: ringOf(item, null).type }).toEqual({ slug: item.slug, type: item.expected });
    }
  });

  it('the vocabulary port gives the server’s own offerings for every live venue', () => {
    for (const item of LIVE_RING_CASES) {
      expect({
        slug: item.slug,
        offerings: deriveOfferings(item.categories ?? [], item.amenities ?? [], item.primaryCategory),
      }).toEqual({ slug: item.slug, offerings: [...(item.offerings ?? [])].sort() });
    }
  });
});

describe('(b) the enum and the fallbacks (the web’s own cases)', () => {
  const type = (
    category: string | null = null,
    rest: Omit<MarkerInput, 'primaryCategory'> = {},
  ): VenueMarkerType => classify({ primaryCategory: category, ...rest }).type;

  it('boutique and premium studio are studios', () => {
    expect(type('premium_studio')).toBe('studio');
    expect(type('boutique')).toBe('studio');
    expect(type('studio')).toBe('studio');
    expect(type('racquet', { categories: ['Padel'] })).toBe('racquet');
  });

  it('a gym with a pool is gym and pool', () => {
    expect(type('gym', { offerings: ['gym-floor', 'pool'] })).toBe('gymPool');
    expect(type('gym', { name: 'World Class Hella & Pool' })).toBe('gymPool');
    expect(type('gym', { name: 'Gym + Pool Selfoss' })).toBe('gymPool');
    expect(type('gym', { name: 'Sundlaug Y' })).toBe('gymPool');
    // A kids' pool is a pool; a cold pool is a cold plunge.
    expect(type('gym', { amenities: ['Kids Pool'] })).toBe('gymPool');
    expect(type('gym', { amenities: ['Cold Pool'] })).toBe('gym');
    expect(type('gym', { amenities: ['SwImMiNg PoOl'] })).toBe('gymPool');
    expect(type('gym', { categories: ['Sundlaug'] })).toBe('gymPool');
  });

  it('the server’s offerings win over the tags', () => {
    expect(type('gym', { offerings: ['gym-floor'], categories: ['Pool'] })).toBe('gym');
  });

  it('the name is a last resort, and only an explicit pool', () => {
    // "Poolside" with no enum is not a pool.
    expect(type(null, { name: 'Poolside Yoga' })).toBe('gym');
    expect(hasPoolSignal({ name: 'Poolside Yoga' })).toBe(false);
    expect(hasPoolSignal({ name: 'Highland pool tours' })).toBe(false);
    expect(hasPoolSignal({ name: 'Sundlaug Akureyrar' })).toBe(true);
  });

  it('without an enum the offerings decide', () => {
    expect(type('climbing', { categories: ['Swimming'] })).toBe('pool');
    expect(type(null, { categories: ['Hot Spring'], name: 'Bláa lónið' })).toBe('lagoon');
    expect(type(null, { categories: ['Hot Spring'], name: 'Hrunalaug' })).toBe('lagoon');
    expect(type(null, { name: 'Vök Baths' })).toBe('lagoon');
    expect(type(null, { amenities: ['Infrared sauna'] })).toBe('recovery');
    expect(type(null, { amenities: ['Hot Tub'] })).toBe('recovery');
    expect(type(null, { categories: ['Spa'] })).toBe('recovery');
    expect(type(null, { offerings: ['massage', 'recovery'] })).toBe('recovery');
    // A raw Recovery tag alone makes no recovery offering.
    expect(type(null, { categories: ['Recovery'] })).toBe('gym');
    // An unknown enum with no signal is a gym.
    expect(type('climbing')).toBe('gym');
    expect(type()).toBe('gym');
  });

  it('coming soon keeps the type', () => {
    expect(classify({ primaryCategory: 'lagoon', awaitingConnection: true })).toEqual({ type: 'lagoon', comingSoon: true });
    expect(classify({ primaryCategory: 'gym', awaitingConnection: null }).comingSoon).toBe(false);
    expect(classify({ primaryCategory: 'gym', awaitingConnection: false }).comingSoon).toBe(false);
  });

  it('a valid server marker type overrides and an invalid one is ignored', () => {
    expect(classify({ primaryCategory: 'gym', serverMarkerType: 'lagoon' }).type).toBe('lagoon');
    expect(classify({ primaryCategory: 'gym', serverMarkerType: 'spaceship' }).type).toBe('gym');
  });
});

describe('(c) the legend', () => {
  it('lists only what is on the map, in order, coming soon last', () => {
    const entries = legendEntries([
      { type: 'lagoon', comingSoon: false },
      { type: 'gym', comingSoon: false },
      { type: 'recovery', comingSoon: true },
      { type: 'gym', comingSoon: false },
    ]);
    expect(entries).toEqual(['gym', 'lagoon', 'comingSoon']);
    expect(legendEntries([])).toEqual([]);
  });

  it('the whole live feed orders as the scheme', () => {
    expect(legendEntries(LIVE_RING_CASES.map((item) => ringOf(item)))).toEqual([
      'gym',
      'gymPool',
      'pool',
      'lagoon',
      'studio',
      'recovery',
      'comingSoon',
    ]);
  });
});

describe('(d) the card’s one line', () => {
  it('keeps the first sentence when it fits', () => {
    expect(
      shortSummary(
        "Forest Lagoon is a new geothermal spa located in Vaðlaskógur forest, a couple of minutes' drive from Akureyri. More here.",
      ),
    ).toBe("Forest Lagoon is a new geothermal spa located in Vaðlaskógur forest, a couple of minutes' drive from Akureyri.");
  });

  it('does not end at an abbreviation or a number', () => {
    expect(shortSummary('Gym in town (est. 2015) at Main St. 5. Classes daily.')).toBe('Gym in town (est. 2015) at Main St. 5.');
  });

  it('clips a long sentence at a word with an ellipsis', () => {
    const long =
      "World Class Laugar is one of Iceland's premier fitness and swimming facilities located at the iconic Laugardalslaug complex with a full gym";
    const summary = shortSummary(long);
    expect(Array.from(summary).length).toBeLessThanOrEqual(110);
    expect(summary.endsWith('…')).toBe(true);
    const body = summary.slice(0, -1);
    expect(long.startsWith(body)).toBe(true);
    expect(body.endsWith(' ')).toBe(false);
  });

  it('collapses runs of white space before it measures', () => {
    expect(shortSummary('  A pool.\n\nWith   a   sauna. ')).toBe('A pool.');
  });

  it('has nothing to say for nothing', () => {
    expect(shortSummary('')).toBe('');
    expect(shortSummary(null)).toBe('');
    expect(shortSummary(undefined)).toBe('');
    expect(shortSummary('   ')).toBe('');
  });
});

describe('(e) colours', () => {
  it('no ring is the sights’ blue, every type has its own hue, and the values are the web’s', () => {
    const rings = [mapRing.gym, mapRing.pool, mapRing.lagoon, mapRing.studio, mapRing.recovery, mapRing.racquet, mapRing.soon];
    const upper = rings.map((hex) => hex.toUpperCase());
    expect(upper).not.toContain('#4EA8DE');
    expect(upper).not.toContain('#2C7DA0');
    expect(upper).not.toContain(colors.attraction.toUpperCase());
    expect(upper).not.toContain(colors.attraction2.toUpperCase());
    expect(new Set(rings).size).toBe(rings.length);
    expect(rings).toEqual(['#FFFFFF', '#191D24', '#155E9E', '#B4532A', '#5B7F4A', '#6E56A8', '#8A8F98']);
    // Gym + pool leads with the gym's snow (the ink is its second half).
    expect(mapRingHex('gymPool')).toBe('#FFFFFF');
  });
});

describe('words', () => {
  it('a pin is named with its type and coming soon', () => {
    expect(accessibilityLabel('gymPool', 'Laugar', false, 'en')).toBe('Laugar, Gym & pool');
    expect(accessibilityLabel('recovery', 'Threk', true, 'en')).toBe('Threk, Spa & recovery, coming soon');
    expect(accessibilityLabel('gymPool', 'Laugar', true, 'is')).toBe('Laugar, Rækt og sundlaug, væntanlegt');
  });

  it('the legend’s words are the web’s', () => {
    const en: Record<VenueMarkerType, string> = {
      gym: 'Gym',
      gymPool: 'Gym + pool',
      pool: 'Pool',
      lagoon: 'Lagoon',
      studio: 'Studio',
      recovery: 'Spa & recovery',
      racquet: 'Racquet',
    };
    const ice: Record<VenueMarkerType, string> = {
      gym: 'Líkamsrækt',
      gymPool: 'Rækt + sund',
      pool: 'Sundlaug',
      lagoon: 'Lón',
      studio: 'Stúdíó',
      recovery: 'Heilsulind',
      racquet: 'Spaðaíþróttir',
    };
    for (const type of VENUE_MARKER_TYPES) {
      expect(shortLabel(type, 'en')).toBe(en[type]);
      expect(shortLabel(type, 'is')).toBe(ice[type]);
      expect(legendLabel(type, 'is')).toBe(ice[type]);
    }
    expect(lookup(COMING_SOON_KEY, 'en')).toBe('Coming soon');
    expect(lookup(COMING_SOON_KEY, 'is')).toBe('Væntanlegt');
    expect(legendLabel('comingSoon', 'en')).toBe('Coming soon');
  });
});

describe('decoded venues', () => {
  const minimalVenue = { id: '610ea437-353d-47a7-af83-e31f9c9d501e', slug: 'x', name: 'X', inBundle: true };

  it('a venue without offerings is a gym', () => {
    expect(classifyVenue(decodeVenue(minimalVenue)).type).toBe('gym');
  });

  it('the server’s marker type and offerings are read from the venue', () => {
    const venue = decodeVenue({ ...minimalVenue, category: 'gym', offerings: ['gym-floor', 'pool'], markerType: 'gymPool' });
    expect(classifyVenue(venue).type).toBe('gymPool');
  });

  it('a stray element keeps the other offerings, so the server still decides the ring', () => {
    const venue = decodeVenue({
      ...minimalVenue,
      category: 'gym',
      categories: ['Gym'],
      amenities: [],
      offerings: ['gym-floor', null, 3, { a: 1 }, ['pool'], true, 'pool'],
    });
    expect(classifyVenue(venue).type).toBe('gymPool');
  });

  it('rings are worked out once per load, the first of two venues with one id winning', () => {
    const lagoon = decodeVenue({ ...minimalVenue, category: 'lagoon' });
    const gym = decodeVenue({ ...minimalVenue, category: 'gym' });
    const rings = classifyAll([lagoon, gym]);
    expect(rings.size).toBe(1);
    expect(rings.get(minimalVenue.id)?.type).toBe('lagoon');
  });
});

describe('the vocabulary’s text rules', () => {
  it('folds Icelandic letters and punctuation the way a keyboard without them types', () => {
    expect(fold('Jarðböðin')).toBe('jardbodin');
    expect(fold('Þórsmörk Æfingar')).toBe('thorsmork aefingar');
    expect(fold("Women's Health")).toBe('women health');
    expect(fold('24/7 gym access')).toBe('24 7 gym access');
  });

  it('strips a plural only from a word long enough to have one', () => {
    expect(stripPlural('saunas')).toBe('sauna');
    expect(stripPlural('boxes')).toBe('box');
    expect(stripPlural('class')).toBe('class');
    expect(stripPlural('spas')).toBe('spa');
    expect(stripPlural('gas')).toBe('gas');
  });
});
