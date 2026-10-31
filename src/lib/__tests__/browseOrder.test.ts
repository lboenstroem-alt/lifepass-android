/**
 * THE VENUE ORDER on Explore's list and behind Home's list: the port of iOS
 * LifePassTests/VenueBrowseOrderTests.swift (2.5.2), case for case, on the
 * same 19-venue catalogue and the same 200 seeds. The web's Browse grid is
 * held to the same rules (browse-venue-order.ts), so the rotation keys below
 * are the web's own numbers.
 *
 * What the owner asked for, as properties: a different mix each time the
 * member comes back to the app, nearest first when the phone really knows
 * where the member is, chains spread out, and "Coming soon" venues never at
 * the top.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { decodeVenue, venueToApi } from '../../api/venues';
import { hasKey, lookup } from '../../i18n';
import { grantedFix, type LocationPermission } from '../../stores/locationStore';
import {
  browseSession,
  createBrowseSession,
  VISIT_GAP_MS,
  type BrowseSessionStore,
} from '../../stores/browseSession';
import { createVenueListStore } from '../../stores/venuesStore';
import { isComingSoon, type Venue } from '../../types/venue';
import {
  bandOf,
  brandKey,
  browseOrder,
  browseOrderWithin,
  comingSoonLast,
  interleaveByBrand,
  rotationKey,
} from '../browseOrder';
import { distanceMeters, ProximityBand, type Coordinate } from '../geo';

// MARK: - Fixtures

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** A venue decoded from the API shape, as the iOS fixture is. */
function venue(
  n: number,
  name: string,
  lat: number | null,
  lon: number | null,
  { comingSoon = false, city = 'Reykjavík' }: { comingSoon?: boolean; city?: string } = {},
): Venue {
  const json: Record<string, unknown> = {
    id: id(n),
    slug: `v${n}`,
    name,
    city,
    awaitingConnection: comingSoon,
    inBundle: true,
  };
  if (lat !== null && lon !== null) json.coordinates = { latitude: lat, longitude: lon };
  return decodeVenue(json);
}

/**
 * Shaped like the live catalogue: a chain with many locations, a second chain,
 * solo venues across the country, and venues still awaiting their booking
 * connection, one of them (600Klifur) alphabetically first, as it is live.
 */
const catalog: Venue[] = [
  venue(1, '600Klifur', 65.68, -18.1, { comingSoon: true, city: 'Akureyri' }),
  venue(2, 'Box800', 64.141, -21.93, { comingSoon: true }),
  venue(3, 'World Class Laugar', 64.1466, -21.875),
  venue(4, 'World Class Kringlan', 64.13, -21.9),
  venue(5, 'World Class Seltjarnarnes', 64.155, -21.99),
  venue(6, 'World Class Smáralind', 64.101, -21.884, { city: 'Kópavogur' }),
  venue(7, 'World Class Akranes', 64.317, -22.057, { city: 'Akranes' }),
  venue(8, 'World Class Selfoss', 63.936, -20.998, { city: 'Selfoss' }),
  venue(9, 'Reebok Fitness Holtagarðar', 64.142, -21.85),
  venue(10, 'Reebok Fitness Lambhagi', 64.137, -21.79),
  venue(11, 'Sky Lagoon', 64.115, -21.98, { city: 'Kópavogur' }),
  venue(12, 'Reykjavik Yoga', 64.1466, -21.9426),
  venue(13, 'Hressó', 64.147, -21.94),
  venue(14, 'Forest Lagoon', 65.695, -18.07, { city: 'Akureyri' }),
  venue(15, 'Vök Baths', 65.304, -14.449, { city: 'Egilsstaðir' }),
  venue(16, 'Sporthúsið Reykjanesbær', 63.978, -22.565, { city: 'Reykjanesbær' }),
  venue(17, 'Norður Akureyri', 65.691, -18.094, { city: 'Akureyri' }),
  venue(18, 'Sundlaug Vestmannaeyja', 63.44, -20.283, { city: 'Vestmannaeyjar' }),
  venue(19, 'Klifurhúsið', 64.13, -21.89, { comingSoon: true }),
];

const reykjavik: Coordinate = { latitude: 64.1466, longitude: -21.9426 };
const akureyri: Coordinate = { latitude: 65.6839, longitude: -18.0906 };
const seeds: number[] = Array.from({ length: 200 }, (_, n) => n * 7919 + 1);

function order(seed: number, origin: Coordinate | null = null, venues: readonly Venue[] = catalog): Venue[] {
  return browseOrder(venues, seed, origin);
}

const ids = (list: readonly Venue[]) => list.map((v) => v.id);
const names = (list: readonly Venue[]) => list.map((v) => v.name);

function shuffled<T>(list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// MARK: - Coming soon

/**
 * The owner's bug: 600Klifur, still awaiting its connection, sat in the top
 * row because the list was effectively alphabetical.
 */
it('every bookable venue comes before every coming-soon one without a fix', () => {
  const bookable = catalog.filter((v) => !isComingSoon(v)).length;
  for (const seed of seeds) {
    const ordered = order(seed);
    expect(ordered.findIndex(isComingSoon)).toBe(bookable);
    expect(ordered.slice(bookable).every(isComingSoon)).toBe(true);
  }
});

/**
 * Distance must not drag a coming-soon venue up: Box800 is a few hundred
 * metres from central Reykjavík, Vök is 400 km away, and Vök still leads.
 */
it('coming soon stays last with a fix, even when it is the nearest', () => {
  for (const seed of seeds) {
    const list = names(order(seed, reykjavik));
    const vok = list.indexOf('Vök Baths');
    expect(vok).toBeGreaterThanOrEqual(0);
    expect(list.indexOf('Box800')).toBeGreaterThan(vok);
    expect(list.indexOf('Klifurhúsið')).toBeGreaterThan(vok);
  }
});

it('coming soon stays last after any filter', () => {
  const filters: ((v: Venue) => boolean)[] = [
    (v) => v.city === 'Akureyri',
    (v) => v.city === 'Reykjavík',
    (v) => v.name.toLowerCase().includes('k'),
  ];
  for (const seed of seeds.slice(0, 40)) {
    for (const origin of [null, reykjavik]) {
      for (const keep of filters) {
        const shown = order(seed, origin).filter(keep);
        const first = shown.findIndex(isComingSoon);
        if (first < 0) continue;
        expect(shown.slice(first).every(isComingSoon)).toBe(true);
      }
    }
  }
});

// MARK: - Distance bands

it('rotation never lifts a venue across a band', () => {
  for (const origin of [reykjavik, akureyri]) {
    for (const seed of seeds) {
      const ordered = order(seed, origin);
      for (const comingSoon of [false, true]) {
        const bands = ordered.filter((v) => isComingSoon(v) === comingSoon).map((v) => bandOf(v, origin));
        expect(bands).toEqual([...bands].sort((a, b) => a - b));
      }
    }
  }
});

it('opens on your own town', () => {
  for (const seed of seeds) {
    expect(['Forest Lagoon', 'Norður Akureyri']).toContain(order(seed, akureyri)[0]?.name);
  }
});

it('still rotates inside a band', () => {
  // Four bookable venues sit within 3 km of central Reykjavík.
  const leaders = new Set(seeds.map((seed) => order(seed, reykjavik)[0]?.id));
  expect(leaders.size).toBeGreaterThanOrEqual(3);
});

it('a venue with no coordinates is furthest and never dropped', () => {
  const withGap = [...catalog, venue(20, 'Nowhere Gym', null, null)];
  for (const seed of seeds.slice(0, 20)) {
    const ordered = order(seed, reykjavik, withGap);
    expect(ordered).toHaveLength(withGap.length);
    const bookable = ordered.filter((v) => !isComingSoon(v));
    const gapAt = bookable.findIndex((v) => v.id === id(20));
    const farFrom = bookable.findIndex((v) => bandOf(v, reykjavik) === ProximityBand.fartherAway);
    expect(gapAt).toBeGreaterThanOrEqual(0);
    expect(farFrom).toBeGreaterThanOrEqual(0);
    expect(gapAt).toBeGreaterThanOrEqual(farFrom);
  }
});

/**
 * No fix, no bands: the label says "Mixed for you", and a venue 400 km away
 * can lead (rotation decides, not distance).
 */
it('without a fix distance decides nothing', () => {
  const leaders = new Set(seeds.map((seed) => order(seed)[0]?.city));
  expect([...leaders].some((city) => city !== 'Reykjavík')).toBe(true);
});

// MARK: - Rotation

it('the same seed gives the same order every time', () => {
  for (const seed of seeds.slice(0, 20)) {
    expect(ids(order(seed))).toEqual(ids(order(seed)));
    expect(ids(order(seed, reykjavik))).toEqual(ids(order(seed, reykjavik)));
  }
});

/**
 * The server's own order must not leak through: the seed alone decides, so a
 * re-sorted catalogue cannot pin a venue to the top.
 */
it('the order does not depend on the order the venues arrive in', () => {
  for (const seed of seeds.slice(0, 20)) {
    expect(ids(order(seed, null, [...catalog].reverse()))).toEqual(ids(order(seed)));
    expect(ids(order(seed, reykjavik, shuffled(catalog)))).toEqual(ids(order(seed, reykjavik)));
  }
});

it('different seeds give different orders', () => {
  expect(ids(order(1))).not.toEqual(ids(order(2)));
  const orders = new Set(seeds.map((seed) => ids(order(seed)).join(',')));
  expect(orders.size).toBe(seeds.length);
});

it('rotates who leads', () => {
  // Ten bookable brands can lead; 200 launches should see nearly all.
  const leaders = new Set(seeds.map((seed) => order(seed)[0]?.id));
  expect(leaders.size).toBeGreaterThanOrEqual(8);
});

/**
 * Brands rotate as units: six World Class rows must not make World Class lead
 * six times as often as Sky Lagoon.
 */
it('a chain with many locations does not crowd the first card', () => {
  const leading = seeds.map((seed) => brandKey(order(seed)[0]?.name ?? ''));
  const share = (brand: string) => leading.filter((key) => key === brand).length / seeds.length;
  expect(share('world')).toBeLessThan(0.2);
  expect(share('sky')).toBeGreaterThan(0.02);
});

/**
 * Explore orders the full list once and filters afterwards, so a filter only
 * removes cards; it never reorders the ones that stay.
 */
it('is stable under filtering', () => {
  const filters: ((v: Venue) => boolean)[] = [
    (v) => v.city === 'Reykjavík',
    (v) => v.name.startsWith('World'),
    (v) => v.id !== id(12),
  ];
  for (const seed of seeds.slice(0, 40)) {
    for (const origin of [null, reykjavik]) {
      const full = ids(order(seed, origin));
      for (const keep of filters) {
        const shown = ids(order(seed, origin).filter(keep));
        expect(shown).toEqual(full.filter((v) => shown.includes(v)));
      }
    }
  }
});

/**
 * A server-side search returns fewer venues. Ordered within the catalogue, the
 * venues it keeps hold the order they had; ordered on their own, brand spacing
 * over the smaller list could reshuffle them.
 */
it('a search ordered within the catalogue keeps the catalogue order', () => {
  const searches: Venue[][] = [
    catalog.filter((v) => v.name.startsWith('World') || v.name.startsWith('Sky')),
    catalog.filter((v) => v.city !== 'Reykjavík'),
    catalog.filter((v) => v.name.toLowerCase().includes('o')),
  ];
  for (const seed of seeds.slice(0, 40)) {
    for (const origin of [null, reykjavik]) {
      const full = ids(order(seed, origin));
      for (const results of searches) {
        const shown = ids(browseOrderWithin(shuffled(results), catalog, seed, origin));
        expect(new Set(shown)).toEqual(new Set(ids(results)));
        expect(shown).toEqual(full.filter((v) => shown.includes(v)));
      }
    }
  }
  // A result the catalogue lacks is ordered with it, coming-soon rule intact.
  const newcomer = venue(21, 'Newcomer Studio', 64.14, -21.93);
  const shown = browseOrderWithin([newcomer, catalog[1]], catalog, 7, null);
  expect(ids(shown)).toEqual([id(21), id(2)]);
  // No catalogue yet: the list is ordered on its own.
  expect(ids(browseOrderWithin(catalog, [], 7, null))).toEqual(ids(order(7)));
});

it('loses and duplicates nothing', () => {
  for (const seed of seeds.slice(0, 20)) {
    for (const origin of [null, reykjavik]) {
      const ordered = order(seed, origin);
      expect(ordered).toHaveLength(catalog.length);
      expect(new Set(ids(ordered))).toEqual(new Set(ids(catalog)));
    }
  }
  expect(order(1, null, [])).toHaveLength(0);
  expect(order(1, reykjavik, [])).toHaveLength(0);
});

// MARK: - The visit (browse session)

/** A session whose next drawn seeds are `draws`, in turn. */
function session({
  seed = 7,
  origin = null,
  fixed = false,
  draws = [1001, 2002],
}: { seed?: number; origin?: Coordinate | null; fixed?: boolean; draws?: number[] } = {}): BrowseSessionStore {
  const next = [...draws];
  return createBrowseSession({ seed, origin, seedIsFixed: fixed, drawSeed: () => next.shift() ?? 0 });
}

const t0 = 1_790_000_000_000;
const minutes = (n: number) => n * 60_000;

/** The app's own session keeps one seed: read twice, the same number. */
it('the shared session holds its seed', () => {
  expect(browseSession.getState().seed).toBe(browseSession.getState().seed);
  expect(VISIT_GAP_MS).toBe(30 * 60 * 1000); // the web's visit window
});

/**
 * Nothing in the foreground draws a seed: becoming active without having been
 * in the background (launch, a dismissed dialog) keeps the mix, however often
 * it happens.
 */
it('the foreground never reshuffles', () => {
  const visit = session();
  for (const minute of [0, 31, 120, 600]) {
    expect(visit.getState().didBecomeActive(t0 + minutes(minute), null)).toBe(false);
  }
  expect(visit.getState().seed).toBe(7);
  expect(visit.getState().revision).toBe(0);
});

/**
 * A suspended app resumes for days, so a seed drawn once per process rarely
 * changed. Back after 30 minutes or more is a new visit with a new mix; back
 * sooner is the same visit.
 */
it('coming back after half an hour is a new visit', () => {
  const visit = session();
  visit.getState().didEnterBackground(t0);
  expect(visit.getState().didBecomeActive(t0 + minutes(29), null)).toBe(false);
  expect(visit.getState().seed).toBe(7); // back within the window: the same mix

  visit.getState().didEnterBackground(t0);
  expect(visit.getState().didBecomeActive(t0 + minutes(30), null)).toBe(true);
  expect(visit.getState().seed).toBe(1001);
  expect(ids(order(7))).not.toEqual(ids(order(visit.getState().seed))); // a new visit shows a different mix
  expect(visit.getState().revision).toBe(1);

  // The background time is used once: activating again is not another visit.
  expect(visit.getState().didBecomeActive(t0 + minutes(90), null)).toBe(false);
  expect(visit.getState().seed).toBe(1001);

  visit.getState().didEnterBackground(t0 + minutes(100));
  expect(visit.getState().didBecomeActive(t0 + 3 * 86_400_000, null)).toBe(true);
  expect(visit.getState().seed).toBe(2002);
});

/** A screenshot run's fixed seed never changes, background or not. */
it('a fixed seed is never redrawn', () => {
  const visit = session({ seed: 42, fixed: true });
  visit.getState().didEnterBackground(t0);
  expect(visit.getState().didBecomeActive(t0 + 86_400_000, null)).toBe(false);
  expect(visit.getState().seed).toBe(42);
});

/** A new visit draws its bands around the latest real fix, or none. */
it('a new visit starts from the latest fix', () => {
  const visit = session({ origin: reykjavik });
  visit.getState().didEnterBackground(t0);
  visit.getState().didBecomeActive(t0 + minutes(45), akureyri);
  expect(visit.getState().origin).toEqual(akureyri);

  visit.getState().didEnterBackground(t0);
  visit.getState().didBecomeActive(t0 + minutes(45), null);
  expect(visit.getState().origin).toBeNull(); // permission gone while away: no distance order
});

/**
 * The bands hold still: the first fix sets them, a later fix less than a
 * kilometre away (Explore asks for one on every visit; GPS wanders) does not
 * move them, a real move does, and permission taken away clears them.
 */
it('the band origin moves only with the member', () => {
  const visit = session();
  visit.getState().locationDidChange(null);
  expect(visit.getState().origin).toBeNull();
  expect(visit.getState().revision).toBe(0); // nothing changed

  visit.getState().locationDidChange(reykjavik);
  expect(visit.getState().origin).toEqual(reykjavik); // the first fix sets the bands
  expect(visit.getState().revision).toBe(1);

  const nearby = { latitude: 64.1466, longitude: -21.9426 - 0.012 }; // ~0.6 km west
  expect(distanceMeters(nearby, reykjavik)).toBeLessThan(1_000);
  visit.getState().locationDidChange(nearby);
  expect(visit.getState().origin).toEqual(reykjavik); // a small move keeps the bands
  expect(visit.getState().revision).toBe(1);

  const across = { latitude: 64.1466, longitude: -21.9426 - 0.03 }; // ~1.5 km west
  expect(distanceMeters(across, reykjavik)).toBeGreaterThan(1_000);
  visit.getState().locationDidChange(across);
  expect(visit.getState().origin).toEqual(across); // a real move re-draws them
  expect(visit.getState().revision).toBe(2);

  visit.getState().locationDidChange(null);
  expect(visit.getState().origin).toBeNull(); // permission taken away: no proximity claim
  expect(visit.getState().revision).toBe(3);
});

/**
 * The review's case: a venue just inside the 3 km band, and a fix 400 m
 * further away that would put it outside. The order shown does not move.
 */
it('a fix near a band edge does not move a card across it', () => {
  // ~2.9 km east of the origin: walkable from it, not from 400 m west of it.
  const edge = venue(90, 'Edge Studio', 64.1466, -21.9426 + 0.0598);
  const list = [...catalog, edge];
  const moved = { latitude: 64.1466, longitude: -21.9426 - 0.0082 };
  expect(distanceMeters(moved, reykjavik)).toBeLessThan(1_000);
  expect(bandOf(edge, reykjavik)).toBe(ProximityBand.walkable);
  expect(bandOf(edge, moved)).toBe(ProximityBand.sameArea); // precondition: the raw fix would re-band it

  const visit = session({ origin: reykjavik });
  const before = ids(order(visit.getState().seed, visit.getState().origin, list));
  visit.getState().locationDidChange(moved);
  expect(ids(order(visit.getState().seed, visit.getState().origin, list))).toEqual(before);
});

/**
 * The same numbers the web computes (`rotationKey` in browse-venue-order.ts,
 * run under Node), so one seed gives one order on both platforms.
 */
it('the rotation keys match the web', () => {
  expect(rotationKey(0, 'brand:world')).toBe(2_517_620_507);
  expect(rotationKey(42, 'brand:world')).toBe(1_685_101_586);
  expect(rotationKey(42, 'brand:hresso')).toBe(1_121_920_354);
  expect(rotationKey(4_294_967_295, 'venue:1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1')).toBe(3_777_386_801);
  expect(rotationKey(7919, 'brand:sporthúsið')).toBe(4_083_419_095);
  expect(rotationKey(1, '')).toBe(3_987_542_849);
});

// MARK: - Chains spread out

it('two World Class venues never sit side by side while another brand waits', () => {
  for (const seed of seeds) {
    const brands = order(seed)
      .filter((v) => !isComingSoon(v))
      .map((v) => brandKey(v.name));
    // Once every other brand is used up, a chain's remaining locations can
    // only follow each other; before that, never.
    let lastOther = -1;
    brands.forEach((brand, index) => {
      if (brand !== 'world') lastOther = index;
    });
    if (lastOther < 1) continue;
    for (let index = 1; index <= lastOther; index += 1) {
      if (brands[index] === 'world') expect(brands[index - 1]).not.toBe('world');
    }
  }
});

it('chains spread out inside each band too', () => {
  for (const seed of seeds) {
    // Band 0 around central Reykjavík holds two World Class and two solo
    // venues: the first three cards are three different brands.
    const firstThree = order(seed, reykjavik)
      .filter((v) => !isComingSoon(v))
      .slice(0, 3)
      .map((v) => brandKey(v.name));
    expect(new Set(firstThree).size).toBe(3);
  }
});

it('the round robin takes one per brand per pass', () => {
  const list = ['World Class A', 'World Class B', 'World Class C', 'Sky Lagoon', 'Reebok Fitness A', 'Reebok Fitness B'];
  expect(interleaveByBrand(list, (name) => name)).toEqual([
    'World Class A',
    'Sky Lagoon',
    'Reebok Fitness A',
    'World Class B',
    'Reebok Fitness B',
    'World Class C',
  ]);
  const distinct = ['Sky Lagoon', 'Hressó', 'Forest Lagoon', 'Vök Baths'];
  expect(interleaveByBrand(distinct, (name) => name)).toEqual(distinct);
});

it('the brand is the first word lower-cased with accents folded', () => {
  expect(brandKey('World Class Kringlan')).toBe('world');
  expect(brandKey('Hressó')).toBe('hresso');
  expect(brandKey('  Sky Lagoon ')).toBe('sky');
  expect(brandKey('Sporthúsið Reykjanesbær')).toBe(brandKey('Sporthúsið Kópavogur'));
});

// MARK: - Home

/** Home's nearest and most-reviewed shelves keep their own ranking, with every bookable venue first. */
it('coming soon last keeps each side in order', () => {
  const mixed = [catalog[0], catalog[2], catalog[1], catalog[3]];
  expect(ids(comingSoonLast(mixed))).toEqual([id(3), id(4), id(1), id(2)]);
});

describe('Home', () => {
  stubApiClientPerTest();

  /** The stub server answers `GET /venues` with the catalogue, encoded back to the API shape. */
  function serveCatalog(): void {
    const rows = catalog.map(venueToApi);
    api.on('GET', '/venues', Reply.ok({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
  }

  /** Home's list arrives in the browse order: the same for the same visit on every reload, coming soon last, nearest band first with a fix. */
  it("Home's list is in the browse order", async () => {
    serveCatalog();
    const noFix = createVenueListStore({ session: session({ seed: 99 }) });
    await noFix.getState().load();
    expect(ids(noFix.getState().ordered())).toEqual(ids(order(99)));
    await noFix.getState().load();
    expect(ids(noFix.getState().ordered())).toEqual(ids(order(99))); // a reload never reshuffles

    const inAkureyri = createVenueListStore({ session: session({ seed: 99, origin: akureyri }) });
    await inAkureyri.getState().load();
    const ordered = inAkureyri.getState().ordered();
    expect(ids(ordered)).toEqual(ids(order(99, akureyri)));
    expect(isComingSoon(ordered[ordered.length - 1])).toBe(true);
  });

  /**
   * On a cold launch Home loads before the first fix. The fix re-orders the
   * list it already has, with no reload, so a later pull to refresh finds
   * nothing to change; a small move after that changes nothing.
   */
  it("Home's list takes up the first fix without a reload", async () => {
    serveCatalog();
    const visit = session({ seed: 99 });
    const home = createVenueListStore({ session: visit });
    await home.getState().load();
    expect(ids(home.getState().ordered())).toEqual(ids(order(99)));

    visit.getState().locationDidChange(akureyri);
    expect(ids(home.getState().ordered())).toEqual(ids(order(99, akureyri))); // banded as soon as the fix lands

    await home.getState().load();
    expect(ids(home.getState().ordered())).toEqual(ids(order(99, akureyri))); // a refresh then changes nothing

    visit.getState().locationDidChange({ latitude: 65.6839, longitude: -18.0906 + 0.01 });
    expect(ids(home.getState().ordered())).toEqual(ids(order(99, akureyri))); // a few hundred metres: same order
  });

  /** Explore and Home read one visit, so they show the same mix. */
  it('Home and Explore read the same visit by default', async () => {
    serveCatalog();
    const home = createVenueListStore();
    await home.getState().load();
    const { seed, origin } = browseSession.getState();
    expect(ids(home.getState().ordered())).toEqual(ids(browseOrder(catalog, seed, origin)));
  });
});

// MARK: - Location

/**
 * Only a fix with permission granted NOW orders a list or prints a distance;
 * a fix kept from before permission was withdrawn does not.
 */
it('only a granted fix counts', () => {
  const fix = reykjavik;
  expect(grantedFix(fix, 'granted')).toBe(fix);
  for (const status of ['denied', 'undetermined'] as LocationPermission[]) {
    expect(grantedFix(fix, status)).toBeNull();
  }
  expect(grantedFix(null, 'granted')).toBeNull();
});

it('the order labels exist in both languages', () => {
  for (const key of ['explore.sort_mixed', 'explore.sort_nearest']) {
    expect(hasKey(key)).toBe(true);
    expect(lookup(key, 'is')).not.toBe(lookup(key, 'en'));
  }
  expect(lookup('explore.sort_mixed', 'en')).toBe('Mixed for you');
  expect(lookup('explore.sort_mixed', 'is')).toBe('Blandað fyrir þig');
  expect(lookup('explore.sort_nearest', 'en')).toBe('Nearest first');
  expect(lookup('explore.sort_nearest', 'is')).toBe('Næst þér fyrst');
  expect(hasKey('explore.sort_recommended')).toBe(false); // the list is no longer in a recommended order
});
