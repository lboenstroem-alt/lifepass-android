/**
 * The sights layer as Mapbox draws it (./features.ts): the ring, dot, target
 * and name properties per feature, the trails' GeoJSON, and which ring a tap
 * meant.
 */
import type { AttractionTrail } from '../../../../api/attractions';
import { colors } from '../../../../theme';
import { sight } from '../../__tests__/fixtures';
import { TRAIL_STROKE } from '../../detail/SightMap';
import { nameAnchor, NO_SIGHTS, NO_TRAILS, pickSight, sightFeatures, TRAIL_STYLES, trailFeatures } from '../features';
import { EMPTY_SIGHTS_LAYOUT, type SightsLayout } from '../sightsLayout';

// The sight card's module (for its trail recipe) brings the UI kit's fonts.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const GULLFOSS = sight('gullfoss', { name: 'Gullfoss', tier: 'top', latitude: 64.3271, longitude: -20.1199 });
const GLYMUR = sight('glymur', { name: 'Glymur', kind: 'hike', tier: 'notable', latitude: 64.3913, longitude: -21.2513 });
const POND = sight('tjornin', { name: 'Tjörnin', nameEn: 'The Pond', tier: 'standard', latitude: 64.1442, longitude: -21.9419 });

function layout(overrides: Partial<SightsLayout> = {}): SightsLayout {
  return { ...EMPTY_SIGHTS_LAYOUT, sights: [GULLFOSS, GLYMUR, POND], ...overrides };
}

function props(collection: ReturnType<typeof sightFeatures>, slug: string) {
  const feature = collection.features.find((item) => item.properties.slug === slug);
  if (!feature) throw new Error(`no ${slug}`);
  return feature.properties;
}

describe('the rings (iOS AttractionMapMarker)', () => {
  it('draws each tier at its size, the stroke half inside as SwiftUI does', () => {
    const drawn = sightFeatures(layout(), null, 'en');
    expect(drawn.features.map((f) => f.geometry.coordinates)).toEqual([
      [-20.1199, 64.3271],
      [-21.2513, 64.3913],
      [-21.9419, 64.1442],
    ]);
    // Top: 22 across, 3.5 stroke; notable 16 and 3; standard 13 and 2.5.
    expect(props(drawn, 'gullfoss')).toMatchObject({ radius: 11 - 1.75, stroke: 3.5, sort: 2, shadowOpacity: 0.25 });
    expect(props(drawn, 'glymur')).toMatchObject({ radius: 8 - 1.5, stroke: 3, sort: 1 });
    expect(props(drawn, 'tjornin')).toMatchObject({ radius: 6.5 - 1.25, stroke: 2.5, sort: 0, shadowOpacity: 0.18 });
  });

  it('gives a top pick a light-blue dot, a trailhead a dark one, and others none', () => {
    const drawn = sightFeatures(layout(), null, 'en');
    expect(props(drawn, 'gullfoss')).toMatchObject({ dot: 3, dotColor: colors.attraction });
    expect(props(drawn, 'glymur')).toMatchObject({ dot: 2.5, dotColor: colors.attraction2 });
    expect(props(drawn, 'tjornin').dot).toBe(0);
  });

  it('grows the open sight and draws it on top', () => {
    const drawn = sightFeatures(layout(), 'tjornin', 'en');
    expect(props(drawn, 'tjornin')).toMatchObject({ radius: 9.5 - 1.75, stroke: 3.5, sort: 3 });
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

  it('takes the top tier first, then the nearest', () => {
    expect(pickSight({ features: drawn, coordinates: at })).toBe('gullfoss');
    const [, glymur, pond] = drawn;
    // Of two equal tiers, the nearer one.
    const nearPond = { ...pond, properties: { ...pond.properties, tier: 'notable' as const } };
    expect(pickSight({ features: [glymur, nearPond], coordinates: { latitude: 64.15, longitude: -21.94 } })).toBe('tjornin');
    expect(pickSight({ features: [glymur, nearPond], coordinates: { latitude: 64.39, longitude: -21.25 } })).toBe('glymur');
  });

  it('counts each ring once whichever of its layers was hit, and ignores anything else', () => {
    const [gullfoss] = drawn;
    const line: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { slug: 'x' } };
    expect(pickSight({ features: [line, gullfoss, gullfoss], coordinates: at })).toBe('gullfoss');
    expect(pickSight({ features: [line], coordinates: at })).toBeNull();
    expect(pickSight({ features: [], coordinates: at })).toBeNull();
  });
});
