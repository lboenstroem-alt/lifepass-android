/**
 * Home's shelves (iOS `HomeView.nearby` and `HomeView.popular`):
 * "A short walk from here" is everything but the hero within 5 km, nearest
 * first, coming soon last, at most six; "Most Popular Now" is the rest by
 * reviews, ties in the browse order, coming soon last, at most four.
 */
import { REYKJAVIK_CENTRE } from '../../../lib/geo';
import { NEARBY_LIMIT, NEARBY_RADIUS_M, nearbyShelf, popularExclusions, popularShelf } from '../shelves';
import { ids, north, REYKJAVIK, testVenue } from './homeVenues';

describe('nearbyShelf', () => {
  it('excludes the hero and anything beyond 5 km, nearest first', () => {
    const hero = testVenue(1, 'Hero', { at: north(100) });
    const close = testVenue(2, 'Close', { at: north(800) });
    const closer = testVenue(3, 'Closer', { at: north(300) });
    const edge = testVenue(4, 'Edge', { at: north(NEARBY_RADIUS_M - 1) });
    const beyond = testVenue(5, 'Beyond', { at: north(NEARBY_RADIUS_M + 50) });
    const shelf = nearbyShelf([hero, close, closer, edge, beyond], hero.id, REYKJAVIK);
    expect(ids(shelf)).toEqual([closer.id, close.id, edge.id]);
  });

  it('shows at most six', () => {
    const venues = Array.from({ length: 9 }, (_, i) => testVenue(i + 1, `V${i + 1}`, { at: north((i + 1) * 200) }));
    const shelf = nearbyShelf(venues, null, REYKJAVIK);
    expect(shelf).toHaveLength(NEARBY_LIMIT);
    expect(ids(shelf)).toEqual(ids(venues.slice(0, 6)));
  });

  it('puts every bookable venue before a coming-soon one, even a nearer one', () => {
    const soon = testVenue(1, 'Soon', { at: north(100), comingSoon: true });
    const open = testVenue(2, 'Open', { at: north(2_000) });
    expect(ids(nearbyShelf([soon, open], null, REYKJAVIK))).toEqual([open.id, soon.id]);
  });

  it('coming soon last is applied before the limit (a seventh bookable venue outranks it)', () => {
    const soon = testVenue(1, 'Soon', { at: north(50), comingSoon: true });
    const open = Array.from({ length: 6 }, (_, i) => testVenue(i + 2, `Open ${i}`, { at: north((i + 1) * 300) }));
    expect(nearbyShelf([soon, ...open], null, REYKJAVIK).map((v) => v.name)).not.toContain('Soon');
  });

  it('without permission measures from Reykjavík centre (a filter, never a distance shown)', () => {
    const downtown = testVenue(1, 'Sundhöllin', { at: north(1_000) });
    const akureyri = testVenue(2, 'Akureyri', { at: { latitude: 65.6835, longitude: -18.1105 } });
    expect(ids(nearbyShelf([downtown, akureyri], null, REYKJAVIK_CENTRE))).toEqual([downtown.id]);
  });

  it('leaves out a venue with no position', () => {
    const nowhere = testVenue(1, 'Nowhere', { at: null });
    expect(nearbyShelf([nowhere], null, REYKJAVIK)).toEqual([]);
  });
});

describe('popularShelf', () => {
  it('ranks by reviews, most first, excluding the hero and Nearby, four at most', () => {
    const v = [
      testVenue(1, 'Hero', { reviews: 500 }),
      testVenue(2, 'Nearby', { reviews: 400 }),
      testVenue(3, 'A', { reviews: 10 }),
      testVenue(4, 'B', { reviews: 90 }),
      testVenue(5, 'C', { reviews: 30 }),
      testVenue(6, 'D', { reviews: 50 }),
      testVenue(7, 'E', { reviews: 5 }),
    ];
    const excluded = popularExclusions(v[0]!.id, [v[1]!]);
    expect(popularShelf(v, excluded).map((x) => x.name)).toEqual(['B', 'D', 'C', 'A']);
  });

  it('ties keep the browse order they were given, so a refresh never reorders them (the 2.5.2 check)', () => {
    const browse = [testVenue(5, 'E'), testVenue(3, 'C'), testVenue(1, 'A'), testVenue(4, 'D', { reviews: 0 })];
    expect(popularShelf(browse, new Set()).map((x) => x.name)).toEqual(['E', 'C', 'A', 'D']);
    // The same visit, read again (a pull to refresh): the same order.
    expect(popularShelf([...browse], new Set()).map((x) => x.name)).toEqual(['E', 'C', 'A', 'D']);
  });

  it('puts coming soon last before taking four', () => {
    const v = [
      testVenue(1, 'Soon', { reviews: 900, comingSoon: true }),
      testVenue(2, 'A', { reviews: 3 }),
      testVenue(3, 'B', { reviews: 2 }),
      testVenue(4, 'C', { reviews: 1 }),
      testVenue(5, 'D'),
    ];
    expect(popularShelf(v, new Set()).map((x) => x.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(popularShelf(v.slice(0, 3), new Set()).map((x) => x.name)).toEqual(['A', 'B', 'Soon']);
  });

  it('popularExclusions holds the hero and every Nearby card', () => {
    const a = testVenue(1, 'A');
    const b = testVenue(2, 'B');
    expect([...popularExclusions(a.id, [b])].sort()).toEqual([a.id, b.id].sort());
    expect([...popularExclusions(null, [b])]).toEqual([b.id]);
  });
});
