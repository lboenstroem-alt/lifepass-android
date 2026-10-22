/**
 * The sights layer on the Explore map (../SightsLayer.tsx): GL sources and
 * layers in a fixed order, a tap that opens the sight it meant (held by the
 * map first, so a venue pin's touch wins), and the TalkBack elements.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { sight } from '../../__tests__/fixtures';
import {
  NO_SIGHTS,
  NO_TRAILS,
  SIGHT_FILTERS,
  SIGHT_LAYER_IDS,
  SIGHT_SHADOWS_SOURCE_ID,
  SIGHTS_SOURCE_ID,
  sightFeatures,
  TRAILS_SOURCE_ID,
  trailFeatures,
} from '../features';
import { EMPTY_SIGHTS_LAYOUT } from '../sightsLayout';
import SightsLayer from '../SightsLayer';
import type { SightsLayerContent } from '../useSightsMap';
import { mapboxLayers } from './mapboxLayers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@rnmapbox/maps', () => require('./mapboxLayers').mapboxLayersModule);

const GULLFOSS = sight('gullfoss', { tier: 'top', latitude: 64.3271, longitude: -20.1199 });
const FAXI = sight('faxi', { tier: 'notable', latitude: 64.2259, longitude: -20.3362 });
const SIGHTS = sightFeatures({ ...EMPTY_SIGHTS_LAYOUT, sights: [GULLFOSS, FAXI] }, null, 'en');
const TRAILS = trailFeatures([
  {
    slug: 'walk',
    name: 'walk',
    lengthM: null,
    durationMinutes: null,
    difficulty: null,
    lines: [
      [
        { latitude: 64.3, longitude: -20.2 },
        { latitude: 64.31, longitude: -20.19 },
      ],
    ],
    bounds: { south: 64.3, west: -20.2, north: 64.31, east: -20.19 },
  },
]);

const select = jest.fn();
const onSelectSight = jest.fn();

function content(overrides: Partial<SightsLayerContent> = {}): SightsLayerContent {
  return { sights: SIGHTS, trails: TRAILS, accessible: [], select, ...overrides };
}

beforeEach(() => {
  mapboxLayers.reset();
  select.mockReset();
  onSelectSight.mockReset();
});

it('mounts both sources from the start, trails under the rings, the rings’ layers in drawing order', async () => {
  await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} />);
  expect(mapboxLayers.sources[TRAILS_SOURCE_ID].shape).toBe(NO_TRAILS);
  expect(mapboxLayers.sources[SIGHTS_SOURCE_ID].shape).toBe(NO_SIGHTS);
  expect(mapboxLayers.order).toEqual([
    TRAILS_SOURCE_ID,
    SIGHT_LAYER_IDS.trailCasing,
    SIGHT_LAYER_IDS.trailLine,
    SIGHT_SHADOWS_SOURCE_ID,
    SIGHT_LAYER_IDS.shadow,
    SIGHTS_SOURCE_ID,
    SIGHT_LAYER_IDS.hit,
    SIGHT_LAYER_IDS.ring,
    SIGHT_LAYER_IDS.name,
  ]);
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.name].kind).toBe('symbol');
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.trailCasing].kind).toBe('line');
  // Rings and their dots share one layer (sorted together); the target and
  // the shadow are the rings' alone.
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.ring].filter).toBeUndefined();
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.hit].filter).toEqual(SIGHT_FILTERS.ring);
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.shadow].filter).toEqual(SIGHT_FILTERS.ring);
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.name].filter).toEqual(SIGHT_FILTERS.name);
});

it('draws what it is handed while on, and nothing (sources still in place) while off', async () => {
  const view = await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content()} />);
  expect(mapboxLayers.sources[SIGHTS_SOURCE_ID].shape).toBe(SIGHTS);
  expect(mapboxLayers.sources[TRAILS_SOURCE_ID].shape).toBe(TRAILS);
  await view.rerender(<SightsLayer visible={false} zoom={6} onSelectSight={onSelectSight} content={content()} />);
  expect(mapboxLayers.sources[SIGHTS_SOURCE_ID].shape).toBe(NO_SIGHTS);
  expect(mapboxLayers.sources[TRAILS_SOURCE_ID].shape).toBe(NO_TRAILS);
});

it('asks Mapbox about the finger’s own point, so each ring’s target decides', async () => {
  await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content()} />);
  expect(mapboxLayers.sources[SIGHTS_SOURCE_ID].hitbox).toEqual({ width: 1, height: 1 });
  // Trails are not tappable (the trailhead ring opens the walk), and nor is a
  // shadow, which reaches past a ring whose target is the ring itself.
  expect(mapboxLayers.sources[TRAILS_SOURCE_ID].onPress).toBeUndefined();
  expect(mapboxLayers.sources[SIGHT_SHADOWS_SOURCE_ID].onPress).toBeUndefined();
  expect(mapboxLayers.sources[SIGHT_SHADOWS_SOURCE_ID].shape).toBe(SIGHTS);
});

it('opens the sight a tap meant (the nearest, without a scale) and makes it the open one', async () => {
  await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content()} />);
  const press = mapboxLayers.sources[SIGHTS_SOURCE_ID].onPress!;
  await act(async () =>
    press({ features: [SIGHTS.features[1], SIGHTS.features[0]], coordinates: { latitude: 64.23, longitude: -20.34 }, point: { x: 0, y: 0 } }),
  );
  expect(select).toHaveBeenCalledWith('faxi');
  expect(onSelectSight).toHaveBeenCalledWith('faxi');
  await act(async () => press({ features: [], coordinates: { latitude: 64.23, longitude: -20.34 }, point: { x: 0, y: 0 } }));
  expect(onSelectSight).toHaveBeenCalledTimes(1);
});

it('tells a drawn ring from a target with the layout’s scale', async () => {
  // Gullfoss and Faxi are about 15.4 km apart: 22 points at 700 m a point.
  // 53 % of the way to Faxi the finger is on Gullfoss's drawn ring (11.6 of
  // its 12.75 points) and nearer Faxi's centre (10.3), but off Faxi's ring (9.5).
  const finger = { latitude: 64.3271 + (64.2259 - 64.3271) * 0.53, longitude: -20.1199 + (-20.3362 + 20.1199) * 0.53 };
  const tap = { features: [SIGHTS.features[1], SIGHTS.features[0]], coordinates: finger, point: { x: 0, y: 0 } };
  const view = await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ metresPerPoint: 700 })} />);
  await act(async () => mapboxLayers.sources[SIGHTS_SOURCE_ID].onPress!(tap));
  expect(onSelectSight).toHaveBeenLastCalledWith('gullfoss');
  // Before the map has a size there is no scale: the nearest centre.
  await view.rerender(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ metresPerPoint: null })} />);
  await act(async () => mapboxLayers.sources[SIGHTS_SOURCE_ID].onPress!(tap));
  expect(onSelectSight).toHaveBeenLastCalledWith('faxi');
});

it('hands a finger’s tap to the map’s hold, and opens only when the map delivers it', async () => {
  const held: (() => void)[] = [];
  const holdTouch = jest.fn((deliver: () => void) => void held.push(deliver));
  await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content()} holdTouch={holdTouch} />);
  const press = mapboxLayers.sources[SIGHTS_SOURCE_ID].onPress!;
  await act(async () => press({ features: [SIGHTS.features[0]], coordinates: { latitude: 64.3271, longitude: -20.1199 }, point: { x: 0, y: 0 } }));
  expect(holdTouch).toHaveBeenCalledTimes(1);
  // Held: a pin may still claim the touch.
  expect(select).not.toHaveBeenCalled();
  expect(onSelectSight).not.toHaveBeenCalled();
  await act(async () => held[0]());
  expect(select).toHaveBeenCalledWith('gullfoss');
  expect(onSelectSight).toHaveBeenCalledWith('gullfoss');
  // A tap on nothing is not held at all.
  await act(async () => press({ features: [], coordinates: { latitude: 64.3271, longitude: -20.1199 }, point: { x: 0, y: 0 } }));
  expect(holdTouch).toHaveBeenCalledTimes(1);
});

it('gives TalkBack a button per drawn ring while a screen reader is on', async () => {
  const accessible = [
    { slug: 'gullfoss', coordinate: [-20.1199, 64.3271] as const, size: 40, label: 'Gullfoss, Top pick' },
    { slug: 'glymur', coordinate: [-21.2513, 64.3913] as const, size: 8 * 2, label: 'Glymur, Trailhead' },
  ];
  const holdTouch = jest.fn();
  const view = await render(
    <SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ accessible })} holdTouch={holdTouch} />,
  );
  const ring = screen.getByLabelText('Gullfoss, Top pick');
  expect(ring).toHaveProp('accessibilityRole', 'button');
  expect(screen.getAllByTestId('markerView')).toHaveLength(2);
  // An activation opens at once: no finger, no pin to lose it to.
  await fireEvent.press(screen.getByLabelText('Glymur, Trailhead'));
  expect(holdTouch).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith('glymur');
  expect(onSelectSight).toHaveBeenCalledWith('glymur');
  await view.rerender(<SightsLayer visible={false} zoom={6} onSelectSight={onSelectSight} content={content({ accessible })} />);
  expect(screen.queryAllByTestId('markerView')).toHaveLength(0);
});

it('keeps a TalkBack button’s position the same object when a new layout leaves it where it was', async () => {
  const first = [{ slug: 'gullfoss', coordinate: [-20.1199, 64.3271] as const, size: 40, label: 'Gullfoss, Top pick' }];
  const view = await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ accessible: first })} />);
  const coordinate = () => (screen.getByTestId('markerView').props as { markerProps: { coordinate: unknown } }).markerProps.coordinate;
  const before = coordinate();
  // A camera that settled again: every entry rebuilt, the same values.
  const again = [{ ...first[0], coordinate: [-20.1199, 64.3271] as const }];
  await view.rerender(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ accessible: again })} />);
  expect(coordinate()).toBe(before);
  const moved = [{ ...first[0], coordinate: [-20.12, 64.3271] as const }];
  await view.rerender(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ accessible: moved })} />);
  expect(coordinate()).toEqual([-20.12, 64.3271]);
});
