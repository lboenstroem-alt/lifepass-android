/**
 * What the sights layer draws for a camera (./sightsLayout.ts): iOS
 * SearchMapView `visibleSights`, `visibleTrailRuns`, `trailsDrawnAtThisZoom`
 * and `layOutSights`, fed by the rules' tier policy and map order.
 */
import type { AttractionMarker, AttractionTrail } from '../../../../api/attractions';
import { sight } from '../../__tests__/fixtures';
import { rankedForMap } from '../../rules';
import { regionOfSpan, type ViewRegion } from '../layout';
import {
  EMPTY_SIGHTS_LAYOUT,
  layOutSights,
  MAX_VISIBLE_SIGHTS,
  MAX_VISIBLE_TRAILS,
  trailsDrawnAtThisZoom,
  trailsInView,
  visibleSights,
  type SightsViewport,
} from '../sightsLayout';

/** Home's "See all on the map": the island with a margin (span 4.2). */
const ICELAND = regionOfSpan({ center: { latitude: 64.96, longitude: -18.6 }, latitudeDelta: 4.2, longitudeDelta: 11.5 });

function around(latitude: number, longitude: number, span: number): ViewRegion {
  return regionOfSpan({ center: { latitude, longitude }, latitudeDelta: span, longitudeDelta: span * 2 });
}

function viewport(region: ViewRegion | null, mapHeight = 600): SightsViewport {
  return { region, screen: null, mapHeight };
}

/** One sight of each tier around Gullfoss, in the feed's (alphabetical) order. */
const FEED: AttractionMarker[] = [
  sight('bruarfoss', { tier: 'standard', latitude: 64.2643, longitude: -20.5157, rankScore: 40 }),
  sight('faxi', { tier: 'notable', latitude: 64.2259, longitude: -20.3362, rankScore: 60 }),
  sight('gullfoss', { tier: 'top', latitude: 64.3271, longitude: -20.1199, rankScore: 98 }),
  sight('geysir', { tier: 'top', latitude: 64.3104, longitude: -20.3024, rankScore: 97 }),
];
const RANKED = rankedForMap(FEED);

function trail(slug: string, south: number, west: number, north: number, east: number): AttractionTrail {
  return {
    slug,
    name: slug,
    lengthM: null,
    durationMinutes: null,
    difficulty: null,
    lines: [
      [
        { latitude: south, longitude: west },
        { latitude: north, longitude: east },
      ],
    ],
    bounds: { south, west, north, east },
  };
}

describe('which rings draw (iOS visibleSights)', () => {
  it('shows only top picks at the Iceland region (span 4.2), in map order', () => {
    expect(visibleSights(RANKED, viewport(ICELAND), null, []).map((s) => s.slug)).toEqual(['gullfoss', 'geysir']);
  });

  it('adds notable sights below a 2.5° span and the rest below 0.8°', () => {
    const golden = (span: number) => visibleSights(RANKED, viewport(around(64.27, -20.3, span)), null, []).map((s) => s.slug);
    expect(golden(2.6)).toEqual(['gullfoss', 'geysir']);
    expect(golden(2.4)).toEqual(['gullfoss', 'geysir', 'faxi']);
    expect(golden(0.8)).toEqual(['gullfoss', 'geysir', 'faxi']);
    expect(golden(0.79)).toEqual(['gullfoss', 'geysir', 'faxi', 'bruarfoss']);
  });

  it('draws only what is in view', () => {
    // A box around Gullfoss alone.
    expect(visibleSights(RANKED, viewport(around(64.3271, -20.1199, 0.05)), null, []).map((s) => s.slug)).toEqual(['gullfoss']);
  });

  it('keeps the open sight’s ring at any zoom and beside any venue', () => {
    const span = around(64.27, -20.3, 3);
    expect(visibleSights(RANKED, viewport(span), 'bruarfoss', []).map((s) => s.slug)).toEqual(['gullfoss', 'geysir', 'bruarfoss']);
  });

  it('caps the rings at 220, the quietest tier first to go', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      sight(`s${i}`, { tier: i < 250 ? 'standard' : 'top', latitude: 64.2 + i * 1e-5, longitude: -20.3, rankScore: 1 }),
    );
    const drawn = visibleSights(rankedForMap(many), viewport(around(64.2, -20.3, 0.5)), null, []);
    expect(drawn).toHaveLength(MAX_VISIBLE_SIGHTS);
    expect(drawn.slice(0, 50).every((s) => s.tier === 'top')).toBe(true);
  });

  it('with a camera it cannot read, shows the priority order without the quietest tier', () => {
    expect(visibleSights(RANKED, viewport(null), null, []).map((s) => s.slug)).toEqual(['gullfoss', 'geysir', 'faxi']);
  });
});

describe('trails (iOS visibleTrailRuns and trailsDrawnAtThisZoom)', () => {
  const trails = [trail('a-tiny', 64.2, -20.3, 64.2001, -20.2999), trail('long', 64.1, -20.6, 64.4, -20.0)];

  it('draws trails only under a 3° span, the speck skipped', () => {
    expect(trailsInView(trails, around(64.27, -20.3, 3.2))).toEqual([]);
    expect(trailsInView(trails, around(64.27, -20.3, 2.9)).map((t) => t.slug)).toEqual(['long']);
    expect(trailsInView(trails, null)).toEqual([]);
  });

  it('caps the trails at 80, the ones covering most of the screen first', () => {
    const many = Array.from({ length: 100 }, (_, i) => trail(`t${String(i).padStart(3, '0')}`, 64.2, -20.3, 64.2 + 0.001 * (i + 1), -20.2));
    const drawn = trailsInView(many, around(64.25, -20.25, 0.5));
    expect(drawn).toHaveLength(MAX_VISIBLE_TRAILS);
    expect(drawn[0].slug).toBe('t099');
  });

  it('lists trails in the legend only where they can draw', () => {
    expect(trailsDrawnAtThisZoom(true, 2, around(64.27, -20.3, 3.2))).toBe(false);
    expect(trailsDrawnAtThisZoom(true, 2, around(64.27, -20.3, 2.9))).toBe(true);
    expect(trailsDrawnAtThisZoom(true, 2, null)).toBe(true);
    expect(trailsDrawnAtThisZoom(true, 0, around(64.27, -20.3, 1))).toBe(false);
    expect(trailsDrawnAtThisZoom(false, 2, around(64.27, -20.3, 1))).toBe(false);
  });
});

describe('the layout (iOS layOutSights)', () => {
  const base = {
    showSights: true,
    ranked: RANKED,
    trails: [] as AttractionTrail[],
    venues: [],
    selectedSlug: null,
    language: 'en' as const,
  };

  it('is empty with the layer off', () => {
    expect(layOutSights({ ...base, showSights: false, viewport: viewport(ICELAND) })).toBe(EMPTY_SIGHTS_LAYOUT);
  });

  it('keeps a ring beside a venue to its own size, within max(300 m, 44 points)', () => {
    // A venue 500 m from Gullfoss.
    const venue = { latitude: 64.3271 + 500 / 111_320, longitude: -20.1199 };
    const mark = { coordinate: venue, titleSize: { width: 40, height: 14 } };
    const region = around(64.3271, -20.1199, 0.05);
    // 0.05° on 600 points: 9.3 m a point, 408 m protected. Too far.
    const roomy = layOutSights({ ...base, viewport: viewport(region, 600), venues: [{ coordinate: venue, mark }] });
    expect(roomy.tight.has('gullfoss')).toBe(false);
    // The same span on a 300-point map: 816 m protected.
    const tight = layOutSights({ ...base, viewport: viewport(region, 300), venues: [{ coordinate: venue, mark }] });
    expect(tight.tight.has('gullfoss')).toBe(true);
  });

  it('names no pick before the map has reported a camera', () => {
    expect(layOutSights({ ...base, viewport: viewport(ICELAND) }).names.size).toBe(0);
  });
});
