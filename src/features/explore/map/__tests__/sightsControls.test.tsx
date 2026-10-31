/**
 * The sights on the real Explore map (ATTR-2 through ../sightsControls and
 * the SightsLayer slot): the toggle, the legend's entries, the ODbL plate,
 * the quiet notice, a ring's tap, trails at a zoom, and Home's "See all on
 * the map". The feeds come from the stub server; the native map is the
 * stand-in, with the GL layers the sights add.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { AccessibilityInfo, LayoutAnimation } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue } from '../../../../api/venues';
import { readReduceMotion } from '../../../../hooks/useReduceMotion';
import { setCurrentLanguage } from '../../../../i18n';
import { createBrowseSession } from '../../../../stores/browseSession';
import { createLocationStore, type LocationStore } from '../../../../stores/locationStore';
import { resetSightsFeeds } from '../../../attractions/map';
import ExploreMap, { type ExploreMapProps } from '../ExploreMap';
import { SIGHTS_TOGGLE_FADE_MS } from '../sightsControls';
import { mapboxStandIn } from './mapboxStandIn';

/** What each ShapeSource was last handed (its tap handler included). */
const mockSources: Record<string, { shape: unknown; onPress?: (event: unknown) => void }> = {};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@rnmapbox/maps', () => {
  const base = require('./mapboxStandIn').mapboxModule;
  return {
    ...base,
    ShapeSource: (props: { id: string; shape: unknown; onPress?: (event: unknown) => void }) => {
      mockSources[props.id] = props;
      return base.ShapeSource(props);
    },
    CircleLayer: () => null,
    LineLayer: () => null,
  };
});
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest({ token: null });

const FEED = {
  attractions: [
    { slug: 'gullfoss', name: 'Gullfoss', kind: 'waterfall', region: 'south', coordinates: { latitude: 64.3271, longitude: -20.1199 }, hasPage: true, tier: 'top', rankScore: 98 },
    { slug: 'faxi', name: 'Faxi', kind: 'waterfall', region: 'south', coordinates: { latitude: 64.2259, longitude: -20.3362 }, hasPage: true, tier: 'notable', rankScore: 60 },
    { slug: 'tjornin', name: 'Tjörnin', nameEn: 'The Pond', kind: 'lake', region: 'capital', coordinates: { latitude: 64.1442, longitude: -21.9419 }, hasPage: true, tier: 'standard', rankScore: 20 },
  ],
  attribution: 'Place data © OpenStreetMap contributors, ODbL 1.0',
};
const TRAILS = {
  trails: [{ slug: 'gullfoss-walk', name: 'Gullfoss', geometry: { type: 'LineString', coordinates: [[-20.13, 64.32], [-20.11, 64.33]] } }],
  attribution: null,
};

const laugar = decodeVenue({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'laugar',
  name: 'Laugar',
  inBundle: true,
  city: 'Reykjavík',
  category: 'gym',
  offerings: ['gym-floor'],
  coordinates: { latitude: 64.146, longitude: -21.877 },
});

let store: LocationStore;
let onOpenSight: jest.Mock;

function serve(feed: object = FEED) {
  api.on('GET', '/attractions', Reply.ok(feed));
  api.on('GET', '/attractions/trails', Reply.ok(TRAILS));
}

async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

async function renderMap(props: Partial<ExploreMapProps> = {}) {
  const view = await render(
    <ExploreMap venues={[laugar]} onOpenVenue={jest.fn()} onOpenSight={onOpenSight} bottomInset={80} locationStore={store} {...props} />,
  );
  await flush();
  return view;
}

/** The rings drawn, by slug (a sight's dot is a feature of its own). */
function rings(): string[] {
  const shape = mockSources['lifepass-sights']?.shape as GeoJSON.FeatureCollection | undefined;
  return (shape?.features ?? []).filter((feature) => feature.properties?.kind === 'ring').map((feature) => String(feature.id));
}

/** A finger's tap on the sights source at the pond. */
async function tapThePond() {
  const shape = mockSources['lifepass-sights'].shape as GeoJSON.FeatureCollection;
  await act(async () =>
    mockSources['lifepass-sights'].onPress?.({
      features: shape.features,
      coordinates: { latitude: 64.1442, longitude: -21.9419 },
      point: { x: 10, y: 10 },
    }),
  );
}

/** Real time passes (the map holds a ring's tap a moment). */
async function pause(ms: number) {
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** The map settles on a box (`onMapIdle`). */
async function settleOn(north: number, south: number, west: number, east: number) {
  await act(async () =>
    (mapboxStandIn.mapProps?.onMapIdle as (state: object) => void)({
      properties: { zoom: 9, bounds: { ne: [east, north], sw: [west, south] }, heading: 0, pitch: 0, center: [0, 0] },
      gestures: { isGestureActive: false },
    }),
  );
}

beforeEach(() => {
  mapboxStandIn.reset();
  for (const id of Object.keys(mockSources)) delete mockSources[id];
  resetSightsFeeds();
  setCurrentLanguage('en');
  onOpenSight = jest.fn();
  store = createLocationStore({
    platform: {
      getPermission: async () => ({ permission: 'denied', canAskAgain: false, approximate: false, servicesEnabled: true }),
      requestPermission: async () => ({ permission: 'denied', canAskAgain: false, approximate: false, servicesEnabled: true }),
      currentFix: async () => ({ latitude: 64.15, longitude: -21.95, accuracy: 10, timestamp: Date.now() }),
    },
    session: createBrowseSession({ seed: 1 }),
    suppressPrompts: () => true,
  });
});

it('opens with the sights on: the toggle, the rings, the legend’s entry and the feed’s own credit', async () => {
  serve();
  await renderMap();
  await waitFor(() => expect(screen.getByTestId('explore.map.sightsCredit')).toBeTruthy());
  expect(screen.getByTestId('explore.map.sightsToggle')).toBeSelected();
  expect(screen.getByTestId('explore.map.sightsToggle')).toHaveProp('accessibilityLabel', 'Sights');
  expect(screen.getByText('Place data © OpenStreetMap contributors, ODbL 1.0')).toBeTruthy();
  expect(screen.getByTestId('explore.legend.sights')).toBeTruthy();
  // Central Reykjavík (span 0.08): every tier in view.
  expect(rings()).toEqual(['tjornin']);
  expect(api.sentAll('/attractions')[0].query).toMatchObject({ locale: 'en' });
});

it('the toggle takes the rings, the trails, the legend’s entries and the credit away, and brings them back', async () => {
  serve();
  await renderMap();
  await settleOn(64.5, 64.0, -20.6, -19.9);
  await waitFor(() => expect(screen.getByTestId('explore.legend.trails')).toBeTruthy());
  expect(rings()).toEqual(['gullfoss', 'faxi']);

  await fireEvent.press(screen.getByTestId('explore.map.sightsToggle'));
  expect(screen.getByTestId('explore.map.sightsToggle')).not.toBeSelected();
  expect(rings()).toEqual([]);
  expect((mockSources['lifepass-trails']?.shape as GeoJSON.FeatureCollection).features).toEqual([]);
  expect(screen.queryByTestId('explore.legend.sights')).toBeNull();
  expect(screen.queryByTestId('explore.legend.trails')).toBeNull();
  expect(screen.queryByTestId('explore.map.sightsCredit')).toBeNull();

  await fireEvent.press(screen.getByTestId('explore.map.sightsToggle'));
  expect(rings()).toEqual(['gullfoss', 'faxi']);
  expect(screen.getByTestId('explore.legend.trails')).toBeTruthy();
});

it('lists trails only at a zoom where they draw (under a 3° span)', async () => {
  serve();
  await renderMap();
  await settleOn(64.5, 64.0, -20.6, -19.9);
  await waitFor(() => expect(screen.getByTestId('explore.legend.trails')).toBeTruthy());
  await settleOn(66.0, 62.8, -24, -14);
  expect(screen.queryByTestId('explore.legend.trails')).toBeNull();
  expect(rings()).toEqual(['gullfoss']);
});

it('says quietly when the sights did not load, and “Try again” asks at once', async () => {
  api.on('GET', '/attractions', Reply.problem(503, 'attractions-unavailable'));
  await renderMap();
  await waitFor(() => expect(screen.getByText('Sights did not load.')).toBeTruthy());
  expect(screen.queryByTestId('explore.map.sightsCredit')).toBeNull();
  // No trails for a layer whose rings never came.
  expect(api.sentAll('/attractions/trails')).toHaveLength(0);

  serve();
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.queryByText('Sights did not load.')).toBeNull());
  expect(api.sentAll('/attractions')).toHaveLength(2);
  expect(rings()).toEqual(['tjornin']);
});

it('a ring’s tap closes the venue’s card and opens the sight, after the map’s hold', async () => {
  serve();
  await renderMap();
  await waitFor(() => expect(rings()).toEqual(['tjornin']));
  await fireEvent.press(screen.getByTestId('explore.map.pin.laugar'));
  expect(screen.getByTestId('explore.venueCard')).toBeTruthy();

  // A separate touch, well after the pin's.
  const later = Date.now() + 2_000;
  const now = jest.spyOn(Date, 'now').mockReturnValue(later);
  try {
    await tapThePond();
    expect(onOpenSight).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenSight).toHaveBeenCalledWith('tjornin'));
    await waitFor(() => expect(screen.queryByTestId('explore.venueCard')).toBeNull());
  } finally {
    now.mockRestore();
  }
});

it('a ring under the same touch as a venue pin leaves it to the venue (a tap on the pool never opens the waterfall)', async () => {
  serve();
  await renderMap();
  await waitFor(() => expect(rings()).toEqual(['tjornin']));
  await fireEvent.press(screen.getByTestId('explore.map.pin.laugar'));
  await tapThePond();
  await pause(150);
  expect(onOpenSight).not.toHaveBeenCalled();
  expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
});

it('Home’s “See all on the map”: the whole island, top picks only', async () => {
  serve();
  await renderMap({ showSightsOnOpen: true });
  await waitFor(() => expect(rings()).toEqual(['gullfoss']));
});

it('fades what the toggle adds or takes away, and not under Remove animations', async () => {
  const fade = jest.spyOn(LayoutAnimation, 'configureNext');
  serve();
  await renderMap();
  await fireEvent.press(screen.getByTestId('explore.map.sightsToggle'));
  expect(fade).toHaveBeenCalledWith(LayoutAnimation.create(SIGHTS_TOGGLE_FADE_MS, 'easeInEaseOut', 'opacity'));
  fade.mockClear();
  const reduceMotion = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;
  reduceMotion.mockImplementation(() => Promise.resolve(true));
  try {
    await act(async () => void (await readReduceMotion()));
    await fireEvent.press(screen.getByTestId('explore.map.sightsToggle'));
    expect(fade).not.toHaveBeenCalled();
  } finally {
    reduceMotion.mockImplementation(() => Promise.resolve(false));
    await act(async () => void (await readReduceMotion()));
    fade.mockRestore();
  }
});
