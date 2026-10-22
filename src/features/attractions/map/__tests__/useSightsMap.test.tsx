/**
 * The Explore map's sights state (./useSightsMap.ts, iOS SearchMapView's
 * sights task and MapViewModel): the 0/5/15/60 s retry schedule and when it
 * stops, the quiet notice, trails after markers, the credit, the open sight
 * and the layout handed to the layer.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, renderHook } from '@testing-library/react-native';
import type { ContextType, ReactNode } from 'react';

import type { AttractionMarkerPage, AttractionTrail, AttractionTrailPage } from '../../../../api/attractions';
import { setCurrentLanguage } from '../../../../i18n';
import { sight } from '../../__tests__/fixtures';
import { attractionMarkersStore, loadAttractionMarkers, resetAttractionMarkers, type MarkersLoadResult } from '../../markersStore';
import { regionOfSpan } from '../layout';
import { loadTrailsFeed } from '../trailsFeed';
import { MARKER_RETRY_DELAYS_MS, useSightsMap, type SightsMapInput } from '../useSightsMap';

// The feeds, answered by hand: the schedule's timing is the subject here.
jest.mock('../../markersStore', () => {
  const actual = jest.requireActual<typeof import('../../markersStore')>('../../markersStore');
  return { ...actual, loadAttractionMarkers: jest.fn() };
});
jest.mock('../trailsFeed', () => ({ ...jest.requireActual('../trailsFeed'), loadTrailsFeed: jest.fn() }));

const loadMarkers = jest.mocked(loadAttractionMarkers);
const loadTrails = jest.mocked(loadTrailsFeed);

const GULLFOSS = sight('gullfoss', { name: 'Gullfoss', tier: 'top', latitude: 64.3271, longitude: -20.1199 });
const FAXI = sight('faxi', { name: 'Faxi', tier: 'notable', latitude: 64.2259, longitude: -20.3362 });
const PAGE: AttractionMarkerPage = { attractions: [GULLFOSS, FAXI], attribution: '© OpenStreetMap contributors, ODbL' };
const WALK: AttractionTrail = {
  slug: 'gullfoss-walk',
  name: 'Gullfoss',
  lengthM: null,
  durationMinutes: null,
  difficulty: null,
  lines: [
    [
      { latitude: 64.32, longitude: -20.13 },
      { latitude: 64.33, longitude: -20.11 },
    ],
  ],
  bounds: { south: 64.32, west: -20.13, north: 64.33, east: -20.11 },
};
const TRAILS: AttractionTrailPage = { trails: [WALK], attribution: null };

const FAILED: MarkersLoadResult = { ok: false, error: new Error('503') };

/** The markers fail every time. */
function markersFail() {
  loadMarkers.mockImplementation(async () => FAILED);
}

/** The markers load (and land in the shared feed, as the real store does). */
function markersLoad() {
  loadMarkers.mockImplementation(async (locale) => {
    attractionMarkersStore.setState({ page: PAGE, locale });
    return { ok: true, page: PAGE };
  });
}

/** Lets the hook's promise chains run. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

/** A screen's navigation that a test can blur and focus. */
function fakeNavigation() {
  let focused = true;
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  const navigation = {
    isFocused: () => focused,
    addListener: (type: 'focus' | 'blur', listener: () => void) => {
      listeners[type].add(listener);
      return () => void listeners[type].delete(listener);
    },
  } as unknown as ContextType<typeof NavigationContext>;
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
    ),
    emit: async (type: 'focus' | 'blur') => {
      focused = type === 'focus';
      await act(async () => listeners[type].forEach((listener) => listener()));
    },
  };
}

const setShowSights = jest.fn();
const ICELAND = { center: { latitude: 64.96, longitude: -18.6 }, latitudeDelta: 4.2, longitudeDelta: 11.5 };
const GOLDEN_CIRCLE = { center: { latitude: 64.27, longitude: -20.3 }, latitudeDelta: 1, longitudeDelta: 2 };

function input(overrides: Partial<SightsMapInput> = {}): SightsMapInput {
  return { showSights: true, setShowSights, openingRegion: GOLDEN_CIRCLE, ...overrides };
}

async function renderSights(initial: SightsMapInput = input(), wrapper?: (props: { children: ReactNode }) => ReactNode) {
  const view = await renderHook((props: SightsMapInput) => useSightsMap(props), { initialProps: initial, wrapper });
  await flush();
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  resetAttractionMarkers();
  setCurrentLanguage('en');
  loadMarkers.mockReset();
  loadTrails.mockReset();
  loadTrails.mockResolvedValue(TRAILS);
  setShowSights.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('loading the markers', () => {
  it('loads when the map appears with the layer on, and not with it off', async () => {
    markersLoad();
    const view = await renderSights(input({ showSights: false }));
    expect(loadMarkers).not.toHaveBeenCalled();
    await view.rerender(input());
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    expect(loadMarkers).toHaveBeenCalledWith('en');
  });

  it('asks again at 0, 5, 15 and 60 seconds while the markers fail, then stops', async () => {
    markersFail();
    await renderSights();
    expect(MARKER_RETRY_DELAYS_MS).toEqual([0, 5_000, 15_000, 60_000]);
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    await wait(4_999);
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(loadMarkers).toHaveBeenCalledTimes(2);
    await wait(15_000);
    expect(loadMarkers).toHaveBeenCalledTimes(3);
    await wait(60_000);
    expect(loadMarkers).toHaveBeenCalledTimes(4);
    await wait(10 * 60_000);
    expect(loadMarkers).toHaveBeenCalledTimes(4);
  });

  it('stops asking once the markers come', async () => {
    markersFail();
    await renderSights();
    markersLoad();
    await wait(5_000);
    expect(loadMarkers).toHaveBeenCalledTimes(2);
    await wait(80_000);
    expect(loadMarkers).toHaveBeenCalledTimes(2);
  });

  it('stops when the toggle turns off, and starts over when it turns on', async () => {
    markersFail();
    const view = await renderSights();
    await view.rerender(input({ showSights: false }));
    await wait(100_000);
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    await view.rerender(input());
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(2);
  });

  it('stops while the list or the classes feed covers the map', async () => {
    markersFail();
    const view = await renderSights();
    await view.rerender(input({ active: false }));
    await wait(100_000);
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    await view.rerender(input({ active: true }));
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(2);
  });

  it('stops when the screen loses focus (a page over Explore), and starts over when it is back', async () => {
    markersFail();
    const navigation = fakeNavigation();
    await renderSights(input(), navigation.wrapper);
    await navigation.emit('blur');
    await wait(100_000);
    expect(loadMarkers).toHaveBeenCalledTimes(1);
    await navigation.emit('focus');
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(2);
  });

  it('reads the markers once in the map’s life', async () => {
    markersLoad();
    const view = await renderSights();
    await view.rerender(input({ active: false }));
    await view.rerender(input({ active: true }));
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(1);
  });
});

describe('the quiet notice', () => {
  it('shows only while the markers failed and none are held, and hides once they arrive', async () => {
    markersFail();
    const view = await renderSights();
    expect(view.result.current.showsRetryNotice).toBe(true);
    // Another surface (Home, search) brought the feed in.
    await act(async () => attractionMarkersStore.setState({ page: PAGE, locale: 'en' }));
    expect(view.result.current.showsRetryNotice).toBe(false);
  });

  it('never shows while the markers are on screen from an earlier read', async () => {
    attractionMarkersStore.setState({ page: PAGE, locale: 'en' });
    markersFail();
    const view = await renderSights();
    expect(view.result.current.showsRetryNotice).toBe(false);
    expect(view.result.current.layer.sights.features.length).toBeGreaterThan(0);
  });

  it('“Try again” asks at once, in the middle of a wait', async () => {
    markersFail();
    const view = await renderSights();
    await wait(2_000);
    await act(async () => view.result.current.retry());
    await flush();
    expect(loadMarkers).toHaveBeenCalledTimes(2);
    // The schedule started over: the next ask is 5 s after this one.
    await wait(4_999);
    expect(loadMarkers).toHaveBeenCalledTimes(2);
    await wait(1);
    expect(loadMarkers).toHaveBeenCalledTimes(3);
  });

  it('shows progress while a request is out', async () => {
    let answer: (result: MarkersLoadResult) => void = () => undefined;
    loadMarkers.mockImplementationOnce(async () => FAILED);
    const view = await renderSights();
    loadMarkers.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await act(async () => view.result.current.retry());
    await flush();
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.showsRetryNotice).toBe(true);
    await act(async () => answer(FAILED));
    await flush();
    expect(view.result.current.loading).toBe(false);
  });

  it('is off with the layer', async () => {
    markersFail();
    const view = await renderSights();
    await view.rerender(input({ showSights: false }));
    expect(view.result.current.showsRetryNotice).toBe(false);
  });
});

describe('trails', () => {
  it('are asked for only after the markers have loaded', async () => {
    markersLoad();
    const view = await renderSights();
    expect(loadTrails).toHaveBeenCalledTimes(1);
    expect(view.result.current.layer.trails.features.map((f) => f.id)).toEqual(['gullfoss-walk']);
  });

  it('are not asked for while the markers fail', async () => {
    markersFail();
    await renderSights();
    await wait(100_000);
    expect(loadTrails).not.toHaveBeenCalled();
  });

  it('are listed in the legend only where they can draw (under 3°)', async () => {
    markersLoad();
    const close = await renderSights(input({ openingRegion: { ...GOLDEN_CIRCLE, latitudeDelta: 2.9 } }));
    expect(close.result.current.legendShowsTrails).toBe(true);
    const far = await renderSights(input({ openingRegion: { ...GOLDEN_CIRCLE, latitudeDelta: 3.2 } }));
    expect(far.result.current.legendShowsTrails).toBe(false);
    expect(far.result.current.layer.trails.features).toEqual([]);
  });

  it('are not listed while no trail has loaded', async () => {
    markersLoad();
    loadTrails.mockResolvedValue(null);
    const view = await renderSights();
    expect(view.result.current.legendShowsTrails).toBe(false);
    expect(view.result.current.legendShowsSights).toBe(true);
  });
});

describe('what the layer draws', () => {
  it('draws only top picks with all of Iceland in view, and the rest closer in', async () => {
    markersLoad();
    const country = await renderSights(input({ openingRegion: ICELAND }));
    expect(country.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss']);
    const region = await renderSights(input({ openingRegion: GOLDEN_CIRCLE }));
    expect(region.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss', 'faxi']);
  });

  it('follows the camera the map reports', async () => {
    markersLoad();
    const view = await renderSights(input({ openingRegion: ICELAND }));
    const golden = regionOfSpan(GOLDEN_CIRCLE);
    await view.rerender(
      input({
        openingRegion: ICELAND,
        camera: { bounds: { ne: [golden.east, golden.north], sw: [golden.west, golden.south] }, heading: 0, pitch: 0 },
        mapSize: { width: 400, height: 700 },
      }),
    );
    expect(view.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss', 'faxi']);
  });

  it('draws nothing with the layer off, and carries the credit only while on', async () => {
    markersLoad();
    const view = await renderSights();
    expect(view.result.current.attribution).toBe('© OpenStreetMap contributors, ODbL');
    await view.rerender(input({ showSights: false }));
    expect(view.result.current.layer.sights.features).toEqual([]);
    expect(view.result.current.layer.trails.features).toEqual([]);
    expect(view.result.current.attribution).toBeNull();
    expect(view.result.current.legendShowsSights).toBe(false);
  });

  it('switches the layer through the toggle', async () => {
    markersLoad();
    const view = await renderSights();
    await act(async () => view.result.current.toggle());
    expect(setShowSights).toHaveBeenCalledWith(false);
  });

  it('keeps the open sight’s ring at any zoom, and lets it go when Explore is back in front', async () => {
    markersLoad();
    const navigation = fakeNavigation();
    const view = await renderSights(input({ openingRegion: ICELAND }), navigation.wrapper);
    expect(view.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss']);
    await act(async () => view.result.current.layer.select('faxi'));
    const faxi = view.result.current.layer.sights.features.find((f) => f.id === 'faxi');
    expect(faxi?.properties.sort).toBe(3);
    await navigation.emit('blur');
    await navigation.emit('focus');
    expect(view.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss']);
  });

  it('makes a sight opened from search the open one, from its next opening on', async () => {
    markersLoad();
    const view = await renderSights(input({ openingRegion: ICELAND, openedSight: { slug: 'faxi', key: 1 } }));
    // The value the map mounts with is not a new opening.
    expect(view.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss']);
    await view.rerender(input({ openingRegion: ICELAND, openedSight: { slug: 'faxi', key: 2 } }));
    expect(view.result.current.layer.sights.features.map((f) => f.id)).toEqual(['gullfoss', 'faxi']);
  });

  it('gives TalkBack an element per drawn ring only while a screen reader is on', async () => {
    markersLoad();
    const view = await renderSights();
    expect(view.result.current.layer.accessible).toEqual([]);
    await view.rerender(input({ screenReaderOn: true }));
    expect(view.result.current.layer.accessible).toEqual([
      { slug: 'gullfoss', coordinate: [-20.1199, 64.3271], size: 40, label: 'Gullfoss, Top pick' },
      { slug: 'faxi', coordinate: [-20.3362, 64.2259], size: 34, label: 'Faxi' },
    ]);
  });
});
