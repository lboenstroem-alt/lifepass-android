/**
 * The sights layer on the Explore map (../SightsLayer.tsx): GL sources and
 * layers in a fixed order, a tap that opens the sight it meant, and the
 * TalkBack elements.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { sight } from '../../__tests__/fixtures';
import { NO_SIGHTS, NO_TRAILS, SIGHT_LAYER_IDS, SIGHTS_SOURCE_ID, sightFeatures, TRAILS_SOURCE_ID, trailFeatures } from '../features';
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
    SIGHTS_SOURCE_ID,
    SIGHT_LAYER_IDS.hit,
    SIGHT_LAYER_IDS.shadow,
    SIGHT_LAYER_IDS.ring,
    SIGHT_LAYER_IDS.dot,
    SIGHT_LAYER_IDS.name,
  ]);
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.name].kind).toBe('symbol');
  expect(mapboxLayers.layers[SIGHT_LAYER_IDS.trailCasing].kind).toBe('line');
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
  // Trails are not tappable: the trailhead ring opens the walk.
  expect(mapboxLayers.sources[TRAILS_SOURCE_ID].onPress).toBeUndefined();
});

it('opens the sight a tap meant (the top tier first) and makes it the open one', async () => {
  await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content()} />);
  const press = mapboxLayers.sources[SIGHTS_SOURCE_ID].onPress!;
  await act(async () =>
    press({ features: [SIGHTS.features[1], SIGHTS.features[0]], coordinates: { latitude: 64.23, longitude: -20.34 }, point: { x: 0, y: 0 } }),
  );
  expect(select).toHaveBeenCalledWith('gullfoss');
  expect(onSelectSight).toHaveBeenCalledWith('gullfoss');
  await act(async () => press({ features: [], coordinates: { latitude: 64.23, longitude: -20.34 }, point: { x: 0, y: 0 } }));
  expect(onSelectSight).toHaveBeenCalledTimes(1);
});

it('gives TalkBack a button per drawn ring while a screen reader is on', async () => {
  const accessible = [
    { slug: 'gullfoss', coordinate: [-20.1199, 64.3271] as const, size: 40, label: 'Gullfoss, Top pick' },
    { slug: 'glymur', coordinate: [-21.2513, 64.3913] as const, size: 8 * 2, label: 'Glymur, Trailhead' },
  ];
  const view = await render(<SightsLayer visible zoom={6} onSelectSight={onSelectSight} content={content({ accessible })} />);
  const ring = screen.getByLabelText('Gullfoss, Top pick');
  expect(ring).toHaveProp('accessibilityRole', 'button');
  expect(screen.getAllByTestId('markerView')).toHaveLength(2);
  await fireEvent.press(screen.getByLabelText('Glymur, Trailhead'));
  expect(select).toHaveBeenCalledWith('glymur');
  expect(onSelectSight).toHaveBeenCalledWith('glymur');
  await view.rerender(<SightsLayer visible={false} zoom={6} onSelectSight={onSelectSight} content={content({ accessible })} />);
  expect(screen.queryAllByTestId('markerView')).toHaveLength(0);
});
