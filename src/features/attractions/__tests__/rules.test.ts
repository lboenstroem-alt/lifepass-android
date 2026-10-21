/**
 * The sights' pure rules (iOS Models/AttractionRanking.swift): tiers and
 * their zoom policy, the map order, trail culling, Home's picks, search and
 * the kind and region labels.
 */
import { translate } from '../../../i18n';
import {
  ATTRACTION_MAP_POLICY,
  HOME_PICKS_LIMIT,
  isAroundIceland,
  kindLabel,
  kindRegionLine,
  mapShows,
  mapShowsTrails,
  matchSights,
  picksForHome,
  rankedForMap,
  regionLabel,
  ringDiameter,
  tierPriority,
  trailOverlap,
  visibleTrails,
} from '../rules';
import { AKUREYRI, LONDON, REYKJAVIK, sight } from './fixtures';

const en = (key: string) => translate(key, 'en');
const is = (key: string) => translate(key, 'is');

describe('tiers', () => {
  it('sorts top, notable, standard', () => {
    expect(tierPriority('top')).toBe(0);
    expect(tierPriority('notable')).toBe(1);
    expect(tierPriority('standard')).toBe(2);
  });

  it('draws rings by tier, larger when selected', () => {
    expect(ringDiameter('top', false)).toBe(22);
    expect(ringDiameter('top', true)).toBe(28);
    expect(ringDiameter('notable', false)).toBe(16);
    expect(ringDiameter('notable', true)).toBe(22);
    expect(ringDiameter('standard', false)).toBe(13);
    expect(ringDiameter('standard', true)).toBe(19);
  });
});

describe('the map policy (AttractionMapPolicy)', () => {
  it('shows top picks at every zoom', () => {
    expect(mapShows('top', 40)).toBe(true);
  });

  it('shows notable sights under 2.5° of latitude and standard ones under 0.8°', () => {
    expect(mapShows('notable', 2.4)).toBe(true);
    expect(mapShows('notable', 2.6)).toBe(false);
    expect(mapShows('notable', ATTRACTION_MAP_POLICY.notableBelowLatitudeSpan)).toBe(false);
    expect(mapShows('standard', 0.7)).toBe(true);
    expect(mapShows('standard', 0.9)).toBe(false);
  });

  it('draws trails under 3°', () => {
    expect(mapShowsTrails(2.9)).toBe(true);
    expect(mapShowsTrails(3)).toBe(false);
  });
});

describe('the map order (rankedForMap)', () => {
  it('orders by tier, then score, then feed order, stably', () => {
    const feed = [
      sight('a', { tier: 'standard', rankScore: 99 }),
      sight('b', { tier: 'notable', rankScore: 10 }),
      sight('c', { tier: 'top', rankScore: 20 }),
      sight('d', { tier: 'notable', rankScore: 10 }),
      sight('e', { tier: 'top', rankScore: 80 }),
      sight('f', { tier: 'notable', rankScore: null }),
      sight('g', { tier: 'notable', rankScore: 0 }),
    ];
    expect(rankedForMap(feed).map((m) => m.slug)).toEqual(['e', 'c', 'b', 'd', 'f', 'g', 'a']);
  });
});

describe('trail culling (TrailViewport.visible)', () => {
  const view = { south: 64, west: -22, north: 65, east: -20 };
  const trail = (slug: string, south: number, west: number, north: number, east: number) => ({
    slug,
    bounds: { south, west, north, east },
  });

  it('keeps the trail in mid-screen over earlier-alphabet trails when capped', () => {
    const trails = [
      trail('a-edge', 64.99, -20.02, 65.1, -19.9),
      trail('b-edge', 63.9, -22.1, 64.01, -21.98),
      trail('z-middle', 64.3, -21.3, 64.7, -20.7),
    ];
    expect(visibleTrails(trails, view, 1).map((t) => t.slug)).toEqual(['z-middle']);
  });

  it('skips trails outside the view and smaller than 1/150 of it in both directions', () => {
    const trails = [
      trail('outside', 66, -22, 66.5, -21),
      trail('smudge', 64.5, -21, 64.501, -20.999),
      trail('due-north', 64.2, -21, 64.6, -21),
    ];
    expect(visibleTrails(trails, view, 10).map((t) => t.slug)).toEqual(['due-north']);
  });

  it('gives a due-north trail its thickness floor, and ties go by slug', () => {
    const floor = { lat: 1 / 150, lon: 2 / 150 };
    expect(trailOverlap({ south: 64.2, west: -21, north: 64.6, east: -21 }, view, floor.lat, floor.lon)).toBeCloseTo(
      (0.4 + floor.lat) * floor.lon,
    );
    const same = [trail('b', 64.2, -21.2, 64.4, -21), trail('a', 64.2, -21.2, 64.4, -21)];
    expect(visibleTrails(same, view, 2).map((t) => t.slug)).toEqual(['a', 'b']);
    expect(visibleTrails(same, view, 0)).toEqual([]);
  });
});

describe('Home’s picks (AttractionPicks.forHome)', () => {
  it('takes only top picks, and none from a server without tiers', () => {
    expect(picksForHome([sight('a', { tier: 'notable' }), sight('b', { tier: 'standard' })], null)).toEqual([]);
    expect(picksForHome([sight('a', { tier: 'notable' }), sight('t', { tier: 'top' })], null).map((m) => m.slug)).toEqual(['t']);
  });

  it('without an origin, round-robins regions in the order of their best pick, one each before a second', () => {
    const tops = [
      sight('s1', { region: 'south', rankScore: 99 }),
      sight('s2', { region: 'south', rankScore: 98 }),
      sight('s3', { region: 'south', rankScore: 97 }),
      sight('n1', { region: 'north', rankScore: 90 }),
      sight('n2', { region: 'north', rankScore: 80 }),
      sight('w1', { region: 'west', rankScore: 85 }),
    ];
    expect(picksForHome(tops, null).map((m) => m.slug)).toEqual(['s1', 'n1', 'w1', 's2', 'n2', 's3']);
  });

  it('covers eight regions with six slots, one each, best regions first', () => {
    const regions = ['capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands'];
    const tops = regions.flatMap((region, i) => [
      sight(`${region}-1`, { region, rankScore: 100 - i }),
      sight(`${region}-2`, { region, rankScore: 50 - i }),
    ]);
    const picks = picksForHome(tops, null);
    expect(picks).toHaveLength(HOME_PICKS_LIMIT);
    expect(picks.map((m) => m.slug)).toEqual(regions.slice(0, 6).map((r) => `${r}-1`));
  });

  it('with an origin, nearest first, ties keeping score order, up to six', () => {
    const tops = [
      sight('far', { latitude: 65.6, longitude: -18.1, rankScore: 99 }),
      sight('near-low', { latitude: 64.15, longitude: -21.94, rankScore: 10 }),
      sight('near-high', { latitude: 64.15, longitude: -21.94, rankScore: 90 }),
      sight('mid', { latitude: 64.0, longitude: -20.0, rankScore: 50 }),
    ];
    expect(picksForHome(tops, REYKJAVIK).map((m) => m.slug)).toEqual(['near-high', 'near-low', 'mid', 'far']);
    expect(picksForHome(tops, AKUREYRI)[0].slug).toBe('far');
    const many = Array.from({ length: 9 }, (_, i) => sight(`s${i}`, { latitude: 64 + i / 10 }));
    expect(picksForHome(many, REYKJAVIK)).toHaveLength(6);
    expect(picksForHome(many, REYKJAVIK, 0)).toEqual([]);
  });

  it('knows when a fix is around Iceland', () => {
    expect(isAroundIceland(REYKJAVIK)).toBe(true);
    expect(isAroundIceland(AKUREYRI)).toBe(true);
    // Grímsey and Vestmannaeyjar are inside the margin.
    expect(isAroundIceland({ latitude: 66.54, longitude: -18.0 })).toBe(true);
    expect(isAroundIceland({ latitude: 63.44, longitude: -20.27 })).toBe(true);
    expect(isAroundIceland(LONDON)).toBe(false);
    expect(isAroundIceland({ latitude: 62.79, longitude: -19 })).toBe(false);
    expect(isAroundIceland({ latitude: 64, longitude: -12.79 })).toBe(false);
  });
});

describe('search (AttractionSearch.matches)', () => {
  const feed = [
    sight('lake', { name: 'Skorradalsvatn', tier: 'standard' }),
    sight('lake2', { name: 'Grænavatn skógar', tier: 'top', rankScore: 99 }),
    sight('skogafoss', { name: 'Skógafoss', tier: 'notable', rankScore: 10 }),
    sight('thing', { name: 'Þingvellir', nameEn: 'Thingvellir' }),
    sight('selja', { name: 'Seljalandsfoss' }),
  ];

  it('puts a name that starts with the query before one that only contains it', () => {
    const hits = matchSights('sko', feed, 10).map((m) => m.slug);
    expect(hits[0]).toBe('skogafoss');
    expect(hits).toContain('lake2');
    expect(hits.indexOf('skogafoss')).toBeLessThan(hits.indexOf('lake2'));
  });

  it('ranks equal matches by tier and then score', () => {
    const hits = matchSights('sk', feed, 10).map((m) => m.slug);
    expect(hits).toEqual(['skogafoss', 'lake', 'lake2']);
  });

  it('finds Icelandic names typed without Icelandic letters, and spaces do not matter', () => {
    expect(matchSights('thingv', feed, 10).map((m) => m.slug)).toEqual(['thing']);
    expect(matchSights('seljalands foss', feed, 10).map((m) => m.slug)).toEqual(['selja']);
  });

  it('needs two characters and a limit', () => {
    expect(matchSights('s', feed, 10)).toEqual([]);
    expect(matchSights(' . ', feed, 10)).toEqual([]);
    expect(matchSights('sko', feed, 0)).toEqual([]);
    expect(matchSights('foss', feed, 1)).toHaveLength(1);
  });
});

describe('labels (AttractionLabels)', () => {
  it('names a kind from the dictionary, an unknown one as a plain Sight', () => {
    expect(kindLabel('waterfall', en)).toBe('Waterfall');
    expect(kindLabel('waterfall', is)).toBe('Foss');
    expect(kindLabel('hot_spring', is)).toBe('Hver');
    expect(kindLabel('sea_stack', en)).toBe('Sight');
    expect(kindLabel('sea_stack', is)).toBe('Áhugaverður staður');
  });

  it('names a region, an unknown one as none', () => {
    expect(regionLabel('south', en)).toBe('South Iceland');
    expect(regionLabel('south', is)).toBe('Suðurland');
    expect(regionLabel('faroes', en)).toBeNull();
  });

  it('writes "Kind · Region", or the kind alone', () => {
    expect(kindRegionLine({ kind: 'waterfall', region: 'south' }, en)).toBe('Waterfall · South Iceland');
    expect(kindRegionLine({ kind: 'hike', region: 'westfjords' }, is)).toBe('Gönguleið · Vestfirðir');
    expect(kindRegionLine({ kind: 'waterfall', region: 'faroes' }, en)).toBe('Waterfall');
  });
});
