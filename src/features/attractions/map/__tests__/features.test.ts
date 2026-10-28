/**
 * The sights layer as Mapbox draws it (./features.ts): the ring, dot, target
 * and name properties per feature, the draw order (each dot with its own
 * ring), the trails' GeoJSON, and which ring a tap meant.
 */
import type { AttractionTrail } from '../../../../api/attractions';
import { colors } from '../../../../theme';
import { sight } from '../../__tests__/fixtures';
import { TRAIL_STROKE } from '../../detail/SightMap';
import {
  nameAnchor,
  NO_SIGHTS,
  NO_TRAILS,
  pickSight,
  SIGHT_FILTERS,
  SIGHT_STYLES,
  sightFeatures,
  TRAIL_STYLES,
  trailFeatures,
} from '../features';
import { HIT_TARGET } from '../layout';
import { EMPTY_SIGHTS_LAYOUT, type SightsLayout } from '../sightsLayout';

// The sight card's module (for its trail recipe) brings the UI kit's fonts.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const GULLFOSS = sight('gullfoss', { name: 'Gullfoss', tier: 'top', latitude: 64.3271, longitude: -20.1199 });
const GLYMUR = sight('glymur', { name: 'Glymur', kind: 'hike', tier: 'notable', latitude: 64.3913, longitude: -21.2513 });
const POND = sight('tjornin', { name: 'Tjörnin', nameEn: 'The Pond', tier: 'standard', latitude: 64.1442, longitude: -21.9419 });

function layout(overrides: Partial<SightsLayout> = {}): SightsLayout {
  return { ...EMPTY_SIGHTS_LAYOUT, sights: [GULLFOSS, GLYMUR, POND], ...overrides };
}

/** A sight's ring feature (`kind: 'ring'`), or its dot. */
function props(collection: ReturnType<typeof sightFeatures>, slug: string, kind: 'ring' | 'dot' = 'ring') {
  const feature = collection.features.find((item) => item.properties.slug === slug && item.properties.kind === kind);
  if (!feature) throw new Error(`no ${kind} for ${slug}`);
  return feature.properties;
}

describe('the rings (iOS AttractionMapMarker)', () => {
  it('draws each tier at its size, the stroke half inside as SwiftUI does', () => {
    const drawn = sightFeatures(layout(), null, 'en');
    // A ring per sight in the map's order, then a dot per sight that has one.
    expect(drawn.features.map((f) => f.id)).toEqual(['gullfoss', 'glymur', 'tjornin', 'gullfoss:dot', 'glymur:dot']);
    expect(drawn.features.map((f) => f.geometry.coordinates)).toEqual([
      [-20.1199, 64.3271],
      [-21.2513, 64.3913],
      [-21.9419, 64.1442],
      [-20.1199, 64.3271],
      [-21.2513, 64.3913],
    ]);
    // Top: 22 across, 3.5 stroke; notable 16 and 3; standard 13 and 2.5.
    expect(props(drawn, 'gullfoss')).toMatchObject({ radius: 11 - 1.75, stroke: 3.5, shadowOpacity: 0.25 });
    expect(props(drawn, 'glymur')).toMatchObject({ radius: 8 - 1.5, stroke: 3 });
    expect(props(drawn, 'tjornin')).toMatchObject({ radius: 6.5 - 1.25, stroke: 2.5, shadowOpacity: 0.18 });
  });

  it('draws top picks over notable over standard, and within a tier the best-known on top', () => {
    const second = sight('skogafoss', { tier: 'top', latitude: 63.5321, longitude: -19.5114 });
    const drawn = sightFeatures(layout({ sights: [GULLFOSS, second, GLYMUR, POND] }), null, 'en');
    const sort = (slug: string) => props(drawn, slug).sort;
    expect(sort('gullfoss')).toBeGreaterThan(sort('skogafoss'));
    expect(sort('skogafoss')).toBeGreaterThan(sort('glymur'));
    expect(sort('glymur')).toBeGreaterThan(sort('tjornin'));
  });

  it('sorts each dot just above its own ring and under every ring drawn over it (iOS draws them as one)', () => {
    const drawn = sightFeatures(layout(), null, 'en');
    const ring = (slug: string) => props(drawn, slug).sort;
    const dot = (slug: string) => props(drawn, slug, 'dot').sort;
    expect(dot('gullfoss')).toBe(ring('gullfoss') + 1);
    expect(dot('glymur')).toBe(ring('glymur') + 1);
    // The notable trailhead's dark dot stays under the top pick's ring.
    expect(dot('glymur')).toBeLessThan(ring('gullfoss'));
    // A dot is no target, casts no shadow and carries no name.
    expect(props(drawn, 'gullfoss', 'dot')).toMatchObject({ kind: 'dot', name: '' });
    expect(SIGHT_FILTERS.ring).toEqual(['==', ['get', 'kind'], 'ring']);
    expect(SIGHT_FILTERS.name[1]).toEqual(SIGHT_FILTERS.ring);
  });

  it('paints a ring white inside its stroke, and a dot as a plain disc of its colour, in one layer', () => {
    const isDot = ['==', ['get', 'kind'], 'dot'];
    expect(SIGHT_STYLES.ring).toMatchObject({
      circleRadius: ['case', isDot, ['get', 'dot'], ['get', 'radius']],
      circleColor: ['case', isDot, ['get', 'dotColor'], '#FFFFFF'],
      circleStrokeColor: colors.attraction,
      circleStrokeWidth: ['case', isDot, 0, ['get', 'stroke']],
      circleSortKey: ['get', 'sort'],
    });
  });

  it('gives a top pick a light-blue dot, a trailhead a dark one, and others none', () => {
    const drawn = sightFeatures(layout(), null, 'en');
    expect(props(drawn, 'gullfoss')).toMatchObject({ dot: 3, dotColor: colors.attraction });
    expect(props(drawn, 'glymur')).toMatchObject({ dot: 2.5, dotColor: colors.attraction2 });
    expect(props(drawn, 'tjornin').dot).toBe(0);
    expect(drawn.features.some((f) => f.id === 'tjornin:dot')).toBe(false);
  });

  it('grows the open sight and draws it on top', () => {
    const drawn = sightFeatures(layout(), 'tjornin', 'en');
    expect(props(drawn, 'tjornin')).toMatchObject({ radius: 9.5 - 1.75, stroke: 3.5 });
    const others = drawn.features.filter((f) => f.properties.slug !== 'tjornin').map((f) => f.properties.sort);
    expect(props(drawn, 'tjornin').sort).toBeGreaterThan(Math.max(...others));
  });

  it('widens the tap target, except beside a venue', () => {
    const drawn = sightFeatures(layout({ tight: new Set(['glymur']) }), null, 'en');
    expect(props(drawn, 'gullfoss').hit).toBe(20);
    expect(props(drawn, 'glymur').hit).toBe(8);
    expect(props(drawn, 'tjornin').hit).toBe(17);
  });

  it('is empty with nothing to draw', () => {
    expect(sightFeatures(EMPTY_SIGHTS_LAYOUT, null, 'en')).toBe(NO_SIGHTS);
    expect(trailFeatures([])).toBe(NO_TRAILS);
  });
});

describe('the names (iOS AttractionMapLabel)', () => {
  it('names only the placed picks, in the member’s language, a point off the ring', () => {
    const names = new Map([['gullfoss', 'below' as const]]);
    const placedPond = new Map([['tjornin', 'trailing' as const]]);
    expect(props(sightFeatures(layout({ names }), null, 'en'), 'gullfoss')).toMatchObject({ name: 'Gullfoss', anchor: 'top' });
    expect(props(sightFeatures(layout({ names }), null, 'en'), 'glymur').name).toBe('');
    expect(props(sightFeatures(layout({ names: placedPond }), null, 'en'), 'tjornin').name).toBe('The Pond');
    expect(props(sightFeatures(layout({ names: placedPond }), null, 'is'), 'tjornin').name).toBe('Tjörnin');
  });

  it('anchors each side and offsets it in ems of the 11 pt text', () => {
    // A 22-point ring: 11 to its edge, 1 gap, and 0.9 to centre the line in 15.
    expect(nameAnchor('below', 22).anchor).toBe('top');
    expect(nameAnchor('below', 22).offset[1]).toBeCloseTo((11 + 1 + 0.9) / 11, 6);
    expect(nameAnchor('above', 22).anchor).toBe('bottom');
    expect(nameAnchor('above', 22).offset[1]).toBeCloseTo(-(11 + 1 + 0.9) / 11, 6);
    expect(nameAnchor('trailing', 22)).toEqual({ anchor: 'left', offset: [12 / 11, 0] });
    expect(nameAnchor('leading', 28)).toEqual({ anchor: 'right', offset: [-15 / 11, 0] });
  });
});

describe('the trails', () => {
  it('are drawn as the sight card draws its route (iOS TrailStroke)', () => {
    expect(TRAIL_STYLES).toEqual(TRAIL_STROKE);
  });

  it('turns each walk into one feature with every run, [longitude, latitude]', () => {
    const walk: AttractionTrail = {
      slug: 'glymur-loop',
      name: 'Glymur',
      lengthM: 7000,
      durationMinutes: 180,
      difficulty: 'moderate',
      lines: [
        [
          { latitude: 64.38, longitude: -21.27 },
          { latitude: 64.39, longitude: -21.25 },
        ],
        [
          { latitude: 64.39, longitude: -21.25 },
          { latitude: 64.4, longitude: -21.24 },
        ],
      ],
      bounds: { south: 64.38, west: -21.27, north: 64.4, east: -21.24 },
    };
    expect(trailFeatures([walk]).features).toEqual([
      {
        type: 'Feature',
        id: 'glymur-loop',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-21.27, 64.38],
              [-21.25, 64.39],
            ],
            [
              [-21.25, 64.39],
              [-21.24, 64.4],
            ],
          ],
        },
        properties: { slug: 'glymur-loop' },
      },
    ]);
  });
});

describe('which ring a tap meant', () => {
  const drawn = sightFeatures(layout(), null, 'en').features;
  const at = { latitude: 64.3, longitude: -20.5 };
  /** 10 m to a point: the rings' sizes in points become ground distances. */
  const MPP = 10;

  /** `points` east of `from`, at `MPP`. */
  function eastOf(from: { latitude: number; longitude: number }, points: number) {
    const metresPerDegree = HIT_TARGET.metresPerDegreeLatitude * Math.cos((from.latitude * Math.PI) / 180);
    return { latitude: from.latitude, longitude: from.longitude + (points * MPP) / metresPerDegree };
  }

  it('without a scale, takes the nearest, and the tier only between equals', () => {
    expect(pickSight({ features: drawn, coordinates: { latitude: 64.33, longitude: -20.12 } })).toBe('gullfoss');
    const [, glymur, pond] = drawn;
    expect(pickSight({ features: [glymur, pond], coordinates: { latitude: 64.15, longitude: -21.94 } })).toBe('tjornin');
    expect(pickSight({ features: [glymur, pond], coordinates: { latitude: 64.39, longitude: -21.25 } })).toBe('glymur');
    // Two sights on one spot: the higher tier.
    const twin = { ...pond, properties: { ...pond.properties, slug: 'twin', tier: 'notable' as const } };
    expect(pickSight({ features: [pond, twin], coordinates: { latitude: 64.15, longitude: -21.94 } })).toBe('twin');
  });

  it('a tap on a notable ring inside a top pick’s widened target opens the notable sight (iOS: the ring under the finger)', () => {
    // 15 points apart: inside the top pick's 40-point target, clear of its 25.5-point ring.
    const top = sight('gullfoss', { tier: 'top', latitude: 64.3271, longitude: -20.1199 });
    const near = sight('bruarfoss', { tier: 'notable', ...eastOf(top, 15) });
    const both = sightFeatures({ ...EMPTY_SIGHTS_LAYOUT, sights: [top, near] }, null, 'en').features;
    expect(pickSight({ features: both, coordinates: eastOf(top, 16) }, MPP)).toBe('bruarfoss');
    // On the top pick's own ring, it is the top pick.
    expect(pickSight({ features: both, coordinates: eastOf(top, 5) }, MPP)).toBe('gullfoss');
  });

  it('a drawn ring under the finger wins over a nearer centre whose ring is not', () => {
    // A standard ring (7.75 points to its outer edge) and a notable one (9.5) 18 points apart.
    const pond = sight('tjornin', { tier: 'standard', latitude: 64.1442, longitude: -21.9419 });
    const glymur = sight('glymur', { tier: 'notable', ...eastOf(pond, 18) });
    const both = sightFeatures({ ...EMPTY_SIGHTS_LAYOUT, sights: [glymur, pond] }, null, 'en').features;
    // 8.6 from the pond's centre (off its ring), 9.4 from Glymur's (on it).
    expect(pickSight({ features: both, coordinates: eastOf(pond, 8.6) }, MPP)).toBe('glymur');
    // Between the two, on neither ring: the nearer.
    expect(pickSight({ features: both, coordinates: eastOf(pond, 8.2) }, MPP)).toBe('tjornin');
  });

  it('counts each ring once whichever of its layers was hit, and ignores anything else', () => {
    const [gullfoss] = drawn;
    const gullfossDot = drawn.find((f) => f.id === 'gullfoss:dot')!;
    const line: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { slug: 'x' } };
    expect(pickSight({ features: [line, gullfoss, gullfossDot, gullfoss], coordinates: at })).toBe('gullfoss');
    expect(pickSight({ features: [line], coordinates: at })).toBeNull();
    expect(pickSight({ features: [], coordinates: at })).toBeNull();
  });
});
