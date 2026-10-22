/**
 * The Explore map (iOS SearchMapView 2.5.5): pins in their type's ring with
 * what TalkBack hears, the two taps and everything that closes the card, the
 * card's lines in both languages, the reveal of a pin pinned under its card,
 * the legend, the camera it opens on, the dot and the locate button, and the
 * overlay stack with "Location is off", a sight opened from search, the
 * sights' controls seam, and a build with no Mapbox token. The native map is
 * stood in for (./mapboxStandIn), so these hold what the map is asked to do.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, DeviceEventEmitter, Dimensions } from 'react-native';

import { decodeVenue } from '../../../../api/venues';
import { setCurrentLanguage } from '../../../../i18n';
import { createBrowseSession } from '../../../../stores/browseSession';
import { createLocationStore, type LocationStore, type PermissionSnapshot } from '../../../../stores/locationStore';
import type { Venue } from '../../../../types/venue';
import ExploreMap, {
  CARD_GAP_ABOVE_BAR,
  LOCATE_ZOOM,
  openedSightRegion,
  SIGHT_CAMERA_MS,
  venueCardBottom,
  type ExploreMapProps,
} from '../ExploreMap';
import { MAP_TAP_HOLD_MS } from '../pinPreview';
import type { SightsMapControls, SightsMapControlsInput } from '../sightsControls';
import { CARD_TRANSITION_MS } from '../VenuePinCard';
import { ICELAND_REGION, regionBounds, REYKJAVIK_REGION } from '../regions';
import { mapboxStandIn } from './mapboxStandIn';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@rnmapbox/maps', () => require('./mapboxStandIn').mapboxModule);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

// The sights layer is ATTR-2's slot: stood in for with a ring that can be tapped.
const mockSightsProps: { visible?: boolean; zoom?: number }[] = [];
jest.mock('../../../attractions/map/SightsLayer', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  return {
    __esModule: true,
    default: (props: { visible: boolean; zoom: number; onSelectSight: (slug: string) => void }) => {
      mockSightsProps.push({ visible: props.visible, zoom: props.zoom });
      return (
        <MockPressable onPress={() => props.onSelectSight('gullfoss')}>
          <MockText>Gullfoss ring</MockText>
        </MockPressable>
      );
    },
  };
});

// The sights' controls are ATTR-2's to fill (../sightsControls); a test can
// hand the map its own to check where they go and what they can switch.
const mockSightsControls: { impl: ((input: SightsMapControlsInput) => SightsMapControls) | null } = { impl: null };
jest.mock('../sightsControls', () => {
  const actual = jest.requireActual('../sightsControls');
  return {
    ...actual,
    useSightsMapControls: (input: SightsMapControlsInput) =>
      mockSightsControls.impl ? mockSightsControls.impl(input) : actual.useSightsMapControls(input),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

function venue(n: number, extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `v${n}`,
    name: `Venue ${n}`,
    inBundle: true,
    city: 'Reykjavík',
    category: 'gym',
    offerings: ['gym-floor'],
    coordinates: { latitude: 64.14 + n / 100, longitude: -21.9 + n / 100 },
    ...extra,
  });
}

const laugar = venue(1, {
  name: 'World Class Laugar & Pool',
  offerings: ['gym-floor', 'pool'],
  description: 'A gym and a pool in Laugardalur. Open early every day.',
  averageRating: 4.62,
});
const sky = venue(2, { name: 'Sky Lagoon', category: 'lagoon', offerings: ['lagoon'], city: 'Kópavogur' });
const threk = venue(3, { name: 'Threk', category: 'recovery', offerings: ['recovery'], awaitingConnection: true, city: null });
const nowhere = venue(4, { name: 'Nowhere', coordinates: null });
const all = [laugar, sky, threk, nowhere];

const granted: PermissionSnapshot = { permission: 'granted', canAskAgain: true, approximate: false, servicesEnabled: true };

let store: LocationStore;
let onOpenVenue: jest.Mock;
let onOpenSight: jest.Mock;
const initialWindow = Dimensions.get('window');

function setWindowWidth(width: number) {
  Dimensions.set({ window: { ...initialWindow, width }, screen: { ...Dimensions.get('screen'), width } });
}

function newStore() {
  return createLocationStore({
    platform: {
      getPermission: async () => granted,
      requestPermission: async () => granted,
      currentFix: async () => ({ latitude: 64.15, longitude: -21.95, accuracy: 10, timestamp: Date.now() }),
    },
    session: createBrowseSession({ seed: 1 }),
    suppressPrompts: () => true,
  });
}

async function renderMap(props: Partial<ExploreMapProps> = {}) {
  const view = await render(
    <ExploreMap
      venues={all}
      onOpenVenue={onOpenVenue}
      onOpenSight={onOpenSight}
      bottomInset={100}
      locationStore={store}
      {...props}
    />,
  );
  await act(async () => undefined);
  return view;
}

function pin(slug: string) {
  return screen.getByTestId(`explore.map.pin.${slug}`);
}

async function tapPin(slug: string) {
  await fireEvent.press(pin(slug));
}

async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  mapboxStandIn.reset();
  mockSightsProps.length = 0;
  mockSightsControls.impl = null;
  setCurrentLanguage('en');
  setWindowWidth(390);
  store = newStore();
  onOpenVenue = jest.fn();
  onOpenSight = jest.fn();
});

afterEach(() => {
  Dimensions.set({ window: initialWindow, screen: Dimensions.get('screen') });
  jest.useRealTimers();
});

describe('the pins', () => {
  it('draws each venue with a position in its type’s ring, and says the type', async () => {
    await renderMap();
    expect(screen.queryByTestId('explore.map.pin.v4')).toBeNull();
    expect(pin('v1').props.accessibilityLabel).toBe('World Class Laugar & Pool, Gym & pool');
    expect(pin('v2').props.accessibilityLabel).toBe('Sky Lagoon, Lagoon');
    expect(pin('v3').props.accessibilityLabel).toBe('Threk, Spa & recovery, coming soon');
    expect(pin('v1').props.accessibilityHint).toBe('Opens the venue');
    expect(pin('v1').props.accessibilityState).toEqual({ selected: false });
    const markers = screen.getAllByTestId('markerView').map((element) => element.props.markerProps);
    expect(markers.every((marker) => marker.allowOverlap && marker.allowOverlapWithPuck)).toBe(true);
    // Mapbox order: longitude, then latitude.
    expect(markers.map((marker) => marker.coordinate)).toEqual(
      [laugar, sky, threk].map((item) => [item.longitude, item.latitude]),
    );
    expect(markers[0].anchor).toEqual({ x: 0.5, y: 0.5 });
  });

  it('says it in Icelandic too', async () => {
    setCurrentLanguage('is');
    await renderMap();
    expect(pin('v1').props.accessibilityLabel).toBe('World Class Laugar & Pool, Rækt og sundlaug');
    expect(pin('v3').props.accessibilityLabel).toBe('Threk, Heilsulind, væntanlegt');
    expect(pin('v1').props.accessibilityHint).toBe('Opnar staðinn');
  });

  it('raises the pinned pin by selecting it, grown and haloed, never by reordering the markers', async () => {
    await renderMap();
    await tapPin('v1');
    // A reordered marker is a native view torn down and added again: the order stays the list's.
    const order = screen.getAllByTestId(/^explore\.map\.pin\./).map((element) => element.props.testID);
    expect(order).toEqual(['explore.map.pin.v1', 'explore.map.pin.v2', 'explore.map.pin.v3']);
    expect(screen.getAllByTestId('markerView').map((element) => element.props.markerProps.isSelected)).toEqual([
      true,
      false,
      false,
    ]);
    expect(pin('v1').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getAllByTestId('venuePin.halo', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('names the venues under their pins, the pinned one placed first', async () => {
    await renderMap();
    await tapPin('v2');
    const shape = mapboxStandIn.shapes['lifepass-venue-names'] as GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; sort: number }>;
    expect(shape.features.map((feature) => [feature.properties.name, feature.properties.sort])).toEqual([
      ['World Class Laugar & Pool', 1],
      ['Sky Lagoon', 0],
      ['Threk', 3],
    ]);
    expect(mapboxStandIn.symbolStyles['lifepass-venue-name']).toMatchObject({ textAllowOverlap: false, textAnchor: 'top' });
  });
});

describe('two taps', () => {
  it('the first tap shows the card, the second opens the venue and clears the map', async () => {
    await renderMap();
    await tapPin('v1');
    expect(onOpenVenue).not.toHaveBeenCalled();
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
    await tapPin('v1');
    expect(onOpenVenue).toHaveBeenCalledWith(laugar);
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
  });

  it('another pin moves the card', async () => {
    await renderMap();
    await tapPin('v1');
    await tapPin('v2');
    expect(onOpenVenue).not.toHaveBeenCalled();
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Lagoon · Kópavogur');
  });

  it('a tap on the card, or on Open venue, opens it', async () => {
    await renderMap();
    await tapPin('v1');
    await fireEvent.press(screen.getByTestId('explore.venueCard.body'));
    expect(onOpenVenue).toHaveBeenCalledWith(laugar);
    await tapPin('v2');
    await fireEvent.press(screen.getByTestId('explore.venueCard.open'));
    expect(onOpenVenue).toHaveBeenLastCalledWith(sky);
  });

  it('the close button closes it, and the next tap is a first tap again', async () => {
    await renderMap();
    await tapPin('v1');
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    await tapPin('v1');
    expect(onOpenVenue).not.toHaveBeenCalled();
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
  });

  it('a tap on open map closes it after the hold', async () => {
    jest.useFakeTimers();
    await renderMap();
    await tapPin('v1');
    jest.setSystemTime(Date.now() + 2_000);
    await act(async () => (mapboxStandIn.mapProps?.onPress as () => void)());
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(MAP_TAP_HOLD_MS));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
  });

  it('a map tap on the pin’s own touch does not close the card it opened', async () => {
    jest.useFakeTimers();
    await renderMap();
    await act(async () => (mapboxStandIn.mapProps?.onPress as () => void)());
    await tapPin('v1');
    await act(async () => jest.advanceTimersByTime(MAP_TAP_HOLD_MS));
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
  });

  it('a second tap whose map tap landed first still opens', async () => {
    jest.useFakeTimers();
    await renderMap();
    await tapPin('v1');
    jest.setSystemTime(Date.now() + 3_000);
    await act(async () => (mapboxStandIn.mapProps?.onPress as () => void)());
    await act(async () => jest.advanceTimersByTime(MAP_TAP_HOLD_MS + 20));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    await tapPin('v1');
    expect(onOpenVenue).toHaveBeenCalledWith(laugar);
  });

  it('a filter or search that takes the venue off the map closes its card', async () => {
    const view = await renderMap();
    await tapPin('v1');
    await view.rerender(
      <ExploreMap venues={[laugar, sky]} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} />,
    );
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
    await view.rerender(<ExploreMap venues={[sky]} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} />);
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
  });

  it('the list, the classes feed or a failed load over the map closes it', async () => {
    const view = await renderMap();
    await tapPin('v1');
    await view.rerender(
      <ExploreMap venues={all} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} active={false} />,
    );
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    await view.rerender(<ExploreMap venues={all} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} active />);
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
  });

  it('a sight opening closes the venue’s card and opens the sight', async () => {
    await renderMap();
    await tapPin('v1');
    await fireEvent.press(screen.getByText('Gullfoss ring'));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    expect(onOpenSight).toHaveBeenCalledWith('gullfoss');
  });

  it('Android’s back closes the card first, and is left to the screen once it is down', async () => {
    const exitApp = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
    await renderMap();
    await tapPin('v1');
    await act(async () => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    // The card took that press: nothing behind it saw one.
    expect(exitApp).not.toHaveBeenCalled();
    // With no card up, back is not the map's.
    await act(async () => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });
    expect(exitApp).toHaveBeenCalledTimes(1);
    exitApp.mockRestore();
  });

  it('an accessibility activation (TalkBack, Switch Access) opens the venue at once', async () => {
    await renderMap();
    await fireEvent(pin('v2'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onOpenVenue).toHaveBeenCalledWith(sky);
    expect(screen.queryByTestId('explore.venueCard', { includeHiddenElements: true })).toBeNull();
    // A finger's tap is still the first of two.
    await tapPin('v1');
    expect(onOpenVenue).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
  });

  it('with TalkBack on, one activation opens the venue', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValueOnce(true);
    await renderMap();
    await flush();
    await tapPin('v2');
    expect(onOpenVenue).toHaveBeenCalledWith(sky);
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
  });
});

describe('the card', () => {
  it('shows the type and town, one English sentence, the rating, Tap again and the price', async () => {
    await renderMap();
    await tapPin('v1');
    expect(screen.getByText('World Class Laugar & Pool')).toBeTruthy();
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Gym & pool · Reykjavík');
    expect(screen.getByTestId('explore.venueCard.summary')).toHaveTextContent('A gym and a pool in Laugardalur.');
    expect(screen.getByTestId('explore.venueCard.rating')).toHaveTextContent(/4\.6$/);
    expect(screen.getByTestId('explore.venueCard.tapAgain', { includeHiddenElements: true })).toHaveTextContent(
      'Tap again to open',
    );
    expect(screen.getByText('Open venue')).toBeTruthy();
    expect(screen.getByText('Included')).toBeTruthy();
  });

  it('says coming soon, and keeps no summary or rating it does not have', async () => {
    await renderMap();
    await tapPin('v3');
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Spa & recovery · Coming soon');
    expect(screen.queryByTestId('explore.venueCard.summary')).toBeNull();
    expect(screen.queryByTestId('explore.venueCard.rating')).toBeNull();
  });

  it('in Icelandic: the Icelandic words and no English sentence', async () => {
    setCurrentLanguage('is');
    await renderMap();
    await tapPin('v1');
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Rækt og sundlaug · Reykjavík');
    expect(screen.queryByTestId('explore.venueCard.summary')).toBeNull();
    expect(screen.getByText('Opna stað')).toBeTruthy();
    expect(screen.getByLabelText('Loka')).toBeTruthy();
  });

  it('slides away when closed, taking no touch on its way, then is gone', async () => {
    jest.useFakeTimers();
    await renderMap();
    await tapPin('v1');
    await fireEvent(screen.getByTestId('explore.venueCard'), 'layout', {
      nativeEvent: { layout: { x: 20, y: 0, width: 350, height: 140 } },
    });
    await act(async () => jest.advanceTimersByTime(CARD_TRANSITION_MS));
    await fireEvent.press(screen.getByLabelText('Close'));
    const leaving = screen.getByTestId('explore.venueCard', { includeHiddenElements: true });
    expect(leaving.props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    await act(async () => jest.advanceTimersByTime(CARD_TRANSITION_MS));
    expect(screen.queryByTestId('explore.venueCard', { includeHiddenElements: true })).toBeNull();
  });

  it('moving to another pin keeps the one card up, with the new venue', async () => {
    await renderMap();
    await tapPin('v1');
    await tapPin('v3');
    expect(screen.getAllByTestId('explore.venueCard', { includeHiddenElements: true })).toHaveLength(1);
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Spa & recovery · Coming soon');
  });

  it('sits 44 dp above the tab bar', async () => {
    expect(venueCardBottom(100)).toBe(100 + CARD_GAP_ABOVE_BAR);
    expect(venueCardBottom(0)).toBe(CARD_GAP_ABOVE_BAR);
    await renderMap({ bottomInset: 90 });
    await tapPin('v1');
    expect(screen.getByTestId('explore.venueCard')).toHaveStyle({ bottom: 134 });
  });
});

describe('the reveal', () => {
  /** Lays the map, the overlay and the card out as a phone would. */
  async function layOut(mapHeight: number, overlayBottom: number, cardHeight: number) {
    await fireEvent(screen.getByTestId('explore.map.area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: mapHeight } },
    });
    await fireEvent(screen.getByTestId('explore.map.overlay'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: overlayBottom } },
    });
    await fireEvent(screen.getByTestId('explore.venueCard'), 'layout', {
      nativeEvent: { layout: { x: 20, y: 0, width: 350, height: cardHeight } },
    });
  }

  it('slides a pin pinned under its card up until its name clears it', async () => {
    jest.useFakeTimers();
    // The map is 784 dp tall and the card's bottom 144 above it: the card runs 500 to 640.
    mapboxStandIn.pointInView = ([longitude]) => (longitude === mapboxStandIn.center[0] ? [195, 392] : [100, 560]);
    await renderMap({ bottomInset: 100, venues: [sky] });
    await tapPin('v2');
    await layOut(784, 99, 140);
    await act(async () => jest.advanceTimersByTime(60));
    await flush();
    // A one-line name: 108 dp up, so the camera's centre goes 108 dp down the screen.
    expect(mapboxStandIn.setCamera).toHaveBeenCalledWith({
      centerCoordinate: [195, 500],
      animationDuration: 250,
      animationMode: 'easeTo',
    });
    expect(screen.getByTestId('explore.venueCard.tapAgain', { includeHiddenElements: true })).toBeTruthy();
  });

  it('on a map too short for the pin, stays put and drops Tap again over a covered pin', async () => {
    jest.useFakeTimers();
    // Small phone: the legend ends at 395, the card runs 428 to 547.
    mapboxStandIn.pointInView = () => [100, 500];
    await renderMap({ bottomInset: 100, venues: [sky] });
    await tapPin('v2');
    await layOut(691, 395, 119);
    await act(async () => jest.advanceTimersByTime(60));
    await flush();
    expect(mapboxStandIn.setCamera).not.toHaveBeenCalled();
    expect(screen.queryByTestId('explore.venueCard.tapAgain', { includeHiddenElements: true })).toBeNull();
  });

  it('a pin clear of the card leaves the map where it is', async () => {
    jest.useFakeTimers();
    mapboxStandIn.pointInView = () => [100, 300];
    await renderMap({ bottomInset: 100, venues: [sky] });
    await tapPin('v2');
    await layOut(784, 99, 140);
    await act(async () => jest.advanceTimersByTime(60));
    await flush();
    expect(mapboxStandIn.setCamera).not.toHaveBeenCalled();
  });
});

describe('the camera and the layers', () => {
  it('opens on central Reykjavík, with the sights layer on', async () => {
    await renderMap();
    expect(mapboxStandIn.cameraDefaults).toEqual({ bounds: regionBounds(REYKJAVIK_REGION), animationDuration: 0 });
    expect(mapboxStandIn.mapProps?.styleURL).toBe('mapbox://styles/mapbox/light-v11');
    expect(mockSightsProps.at(-1)?.visible).toBe(true);
  });

  it('opens on all of Iceland for Home’s See all on the map', async () => {
    await renderMap({ showSightsOnOpen: true });
    expect(mapboxStandIn.cameraDefaults).toEqual({ bounds: regionBounds(ICELAND_REGION), animationDuration: 0 });
    expect(mockSightsProps.at(-1)?.visible).toBe(true);
  });

  it('hands the sights layer the zoom the map reports', async () => {
    await renderMap();
    await act(async () =>
      (mapboxStandIn.mapProps?.onMapIdle as (state: object) => void)({ properties: { zoom: 9.5 }, gestures: {} }),
    );
    expect(mockSightsProps.at(-1)?.zoom).toBe(9.5);
  });

  it('keeps Mapbox’s logo and credit above the tab bar', async () => {
    await renderMap({ bottomInset: 100 });
    expect(mapboxStandIn.mapProps?.logoPosition).toEqual({ bottom: 104, left: 8 });
    expect(mapboxStandIn.mapProps?.attributionPosition).toEqual({ bottom: 104, left: 92 });
  });
});

describe('the legend', () => {
  it('folds on a phone behind Venue types, the heading in view', async () => {
    await renderMap();
    expect(screen.getByText('LifePass venues')).toBeTruthy();
    const toggle = screen.getByTestId('explore.legend.venueTypes');
    expect(toggle.props.accessibilityLabel).toBe('Venue types');
    expect(toggle.props.accessibilityValue).toEqual({ text: 'Collapsed' });
    expect(screen.queryByText('Ring colour shows the type of venue')).toBeNull();

    await fireEvent.press(toggle);
    expect(screen.getByText('Ring colour shows the type of venue')).toBeTruthy();
    // Only the types on the map, in the scheme's order, coming soon last.
    const entries = screen.getAllByTestId(/^explore\.legend\.entry\./).map((element) => element.props.accessibilityLabel);
    expect(entries).toEqual(['Gym + pool', 'Lagoon', 'Coming soon']);
    expect(screen.getByTestId('explore.legend.venueTypes.close').props.accessibilityValue).toEqual({ text: 'Expanded' });

    await fireEvent.press(screen.getByTestId('explore.legend.venueTypes.close'));
    expect(screen.queryByText('Ring colour shows the type of venue')).toBeNull();
  });

  it('lists the types open on a tablet', async () => {
    setWindowWidth(800);
    await renderMap();
    expect(screen.queryByTestId('explore.legend.venueTypes')).toBeNull();
    expect(screen.getByText('Ring colour shows the type of venue')).toBeTruthy();
  });

  it('follows the venues on the map', async () => {
    setWindowWidth(800);
    const view = await renderMap();
    await view.rerender(<ExploreMap venues={[sky]} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} />);
    const entries = screen.getAllByTestId(/^explore\.legend\.entry\./).map((element) => element.props.accessibilityLabel);
    expect(entries).toEqual(['Lagoon']);
  });

  it('is in Icelandic in Icelandic', async () => {
    setCurrentLanguage('is');
    await renderMap();
    expect(screen.getByText('LifePass staðir')).toBeTruthy();
    expect(screen.getByTestId('explore.legend.venueTypes').props.accessibilityValue).toEqual({ text: 'Lokað' });
    await fireEvent.press(screen.getByTestId('explore.legend.venueTypes'));
    expect(screen.getByText('Litur hringsins sýnir tegund staðar')).toBeTruthy();
  });

  it('draws nothing with no venue on the map and no sights', async () => {
    // The sights layer off (ATTR-2's seam answers nothing for the legend).
    mockSightsControls.impl = () => ({ toggle: null, belowLegend: null, legendShowsSights: false, legendShowsTrails: false });
    await renderMap({ venues: [] });
    expect(screen.queryByTestId('explore.legend')).toBeNull();
  });
});

describe('location', () => {
  it('shows the dot and the locate button while location is allowed, and the button centres the map on it', async () => {
    store.setState({
      permission: 'granted',
      permissionKnown: true,
      currentLocation: { latitude: 64.15, longitude: -21.95, accuracy: 10, timestamp: Date.now() },
    });
    await renderMap();
    expect(screen.getByTestId('locationPuck')).toBeTruthy();
    expect(screen.queryByTestId('explore.locationOff')).toBeNull();
    const locate = screen.getByLabelText('Show where I am');
    await fireEvent.press(locate);
    await flush();
    expect(mapboxStandIn.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({ centerCoordinate: [-21.95, 64.15], zoomLevel: expect.any(Number) }),
    );
    const { zoomLevel } = mapboxStandIn.setCamera.mock.calls[0][0] as { zoomLevel: number };
    expect(zoomLevel).toBeGreaterThanOrEqual(LOCATE_ZOOM);
  });

  it('asks first when the member has not decided, then centres on the fix', async () => {
    const requestLocation = jest.fn(async () => {
      store.setState({
        permission: 'granted',
        permissionKnown: true,
        currentLocation: { latitude: 65.68, longitude: -18.09, accuracy: 10, timestamp: Date.now() },
      });
    });
    store.setState({ permission: 'undetermined', permissionKnown: true, requestLocation });
    await renderMap();
    expect(screen.queryByTestId('locationPuck')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Show where I am'));
    await flush();
    expect(requestLocation).toHaveBeenCalled();
    expect(mapboxStandIn.setCamera).toHaveBeenCalledWith(expect.objectContaining({ centerCoordinate: [-18.09, 65.68] }));
  });

  it('drops the dot while the map is covered, so location updates stop, and brings it back with the map', async () => {
    store.setState({ permission: 'granted', permissionKnown: true });
    const view = await renderMap();
    expect(screen.getByTestId('locationPuck')).toBeTruthy();
    await view.rerender(
      <ExploreMap venues={all} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} active={false} />,
    );
    expect(screen.queryByTestId('locationPuck')).toBeNull();
    await view.rerender(<ExploreMap venues={all} onOpenVenue={onOpenVenue} onOpenSight={onOpenSight} locationStore={store} active />);
    expect(screen.getByTestId('locationPuck')).toBeTruthy();
  });

  it('with location off: no dot, no locate button, and the banner under the legend', async () => {
    store.setState({ permission: 'denied', permissionKnown: true, servicesEnabled: true });
    await renderMap();
    expect(screen.queryByTestId('locationPuck')).toBeNull();
    expect(screen.queryByTestId('explore.map.locate')).toBeNull();
    const overlay = screen.getByTestId('explore.map.overlay');
    expect(overlay).toContainElement(screen.getByTestId('explore.locationOff'));
    expect(screen.getByText('Location is off')).toBeTruthy();
  });
});

describe('a sight opened from search (iOS openSearchedSight)', () => {
  const gullfoss = { latitude: 64.3271, longitude: -20.1199 };

  function withSight(openedSight: ExploreMapProps['openedSight'], extra: Partial<ExploreMapProps> = {}) {
    return (
      <ExploreMap
        venues={all}
        onOpenVenue={onOpenVenue}
        onOpenSight={onOpenSight}
        locationStore={store}
        openedSight={openedSight}
        {...extra}
      />
    );
  }

  it('closes the venue’s card and brings the sight into view with the sights on', async () => {
    const view = await renderMap();
    await tapPin('v1');
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: gullfoss, key: 1 }));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    expect(mapboxStandIn.setCamera).toHaveBeenCalledWith({
      bounds: regionBounds(openedSightRegion(gullfoss)),
      animationDuration: SIGHT_CAMERA_MS,
      animationMode: 'easeTo',
    });
    expect(openedSightRegion(gullfoss)).toEqual({ center: gullfoss, latitudeDelta: 0.25, longitudeDelta: 0.5 });
    expect(mockSightsProps.at(-1)?.visible).toBe(true);
    // The map does not open the sight's card itself: the search group did.
    expect(onOpenSight).not.toHaveBeenCalled();
  });

  it('counts each opening once, and the same sight opened again as a new one', async () => {
    const view = await renderMap();
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: gullfoss, key: 1 }));
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: gullfoss, key: 1 }, { bottomInset: 80 }));
    expect(mapboxStandIn.setCamera).toHaveBeenCalledTimes(1);
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: gullfoss, key: 2 }));
    expect(mapboxStandIn.setCamera).toHaveBeenCalledTimes(2);
  });

  it('the opening the map mounts with is not a new one', async () => {
    await renderMap({ openedSight: { slug: 'gullfoss', coordinate: gullfoss, key: 7 } });
    expect(mapboxStandIn.setCamera).not.toHaveBeenCalled();
  });

  it('under the list it closes the card but leaves the camera; with no position, the card only', async () => {
    const view = await renderMap();
    await tapPin('v1');
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: null, key: 1 }));
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    expect(mapboxStandIn.setCamera).not.toHaveBeenCalled();
    await view.rerender(withSight({ slug: 'gullfoss', coordinate: gullfoss, key: 2 }, { active: false }));
    expect(mapboxStandIn.setCamera).not.toHaveBeenCalled();
  });
});

describe('the sights’ controls (ATTR-2’s seam, ../sightsControls)', () => {
  it('by default (ATTR-2’s controls) shows the toggle on and lists the sights, not trails it is not drawing', async () => {
    setWindowWidth(800);
    await renderMap();
    expect(screen.getByTestId('explore.map.sightsToggle')).toBeSelected();
    expect(screen.getByTestId('explore.legend.sights')).toBeTruthy();
    expect(screen.queryByTestId('explore.legend.trails')).toBeNull();
  });

  it('places what they return and lets the toggle switch the layer', async () => {
    setWindowWidth(800);
    const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
    const seen: SightsMapControlsInput[] = [];
    mockSightsControls.impl = (input) => {
      seen.push(input);
      return {
        toggle: (
          <Pressable testID="sightsToggle" onPress={() => input.setShowSights(!input.showSights)}>
            <Text>Sights</Text>
          </Pressable>
        ),
        belowLegend: <Text>Map data OpenStreetMap</Text>,
        legendShowsSights: input.showSights,
        legendShowsTrails: input.showSights && input.zoom >= 12,
      };
    };
    await renderMap();
    const overlay = screen.getByTestId('explore.map.overlay');
    expect(overlay).toContainElement(screen.getByTestId('sightsToggle'));
    expect(overlay).toContainElement(screen.getByText('Map data OpenStreetMap'));
    expect(screen.getByTestId('explore.legend.sights')).toBeTruthy();
    expect(seen.at(-1)?.showSights).toBe(true);

    await fireEvent.press(screen.getByTestId('sightsToggle'));
    expect(mockSightsProps.at(-1)?.visible).toBe(false);
    expect(screen.queryByTestId('explore.legend.sights')).toBeNull();

    await fireEvent.press(screen.getByTestId('sightsToggle'));
    await act(async () =>
      (mapboxStandIn.mapProps?.onMapIdle as (state: object) => void)({ properties: { zoom: 13 }, gestures: {} }),
    );
    expect(seen.at(-1)?.zoom).toBe(13);
    expect(screen.getByTestId('explore.legend.trails')).toBeTruthy();
  });
});

describe('a build without a Mapbox token', () => {
  const original = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  afterEach(() => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = original;
  });

  it('draws a plain area and never builds a Mapbox map (which would throw without one)', async () => {
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN = '';
    await renderMap();
    expect(screen.getByTestId('explore.map.unavailable')).toBeTruthy();
    expect(screen.queryByTestId('explore.map.view')).toBeNull();
    expect(mapboxStandIn.mapProps).toBeNull();
    expect(screen.queryByTestId('markerView')).toBeNull();
    expect(screen.queryByTestId('locationPuck')).toBeNull();
  });
});

describe('development aids (iOS DEBUG launch arguments)', () => {
  const original = process.env.EXPO_PUBLIC_FIXTURE;
  afterEach(() => {
    process.env.EXPO_PUBLIC_FIXTURE = original;
  });

  it('mapPinned pins that venue’s card once it is on the map', async () => {
    jest.useFakeTimers();
    process.env.EXPO_PUBLIC_FIXTURE = 'mapPinned=v2';
    await renderMap();
    expect(screen.queryByTestId('explore.venueCard')).toBeNull();
    await act(async () => jest.advanceTimersByTime(400));
    expect(screen.getByTestId('explore.venueCard.type')).toHaveTextContent('Lagoon · Kópavogur');
  });

  it('mapLegendOpen opens the phone legend’s type list', async () => {
    process.env.EXPO_PUBLIC_FIXTURE = 'mapLegendOpen';
    await renderMap();
    expect(screen.getByText('Ring colour shows the type of venue')).toBeTruthy();
  });

  it('debugAssistiveTech opens a venue in one activation', async () => {
    process.env.EXPO_PUBLIC_FIXTURE = 'debugAssistiveTech';
    await renderMap();
    await tapPin('v1');
    expect(onOpenVenue).toHaveBeenCalledWith(laugar);
  });

  it('debugMapTapFirst: the map hears the touch first and the pin late, and the second tap still opens', async () => {
    jest.useFakeTimers();
    process.env.EXPO_PUBLIC_FIXTURE = 'debugMapTapFirst=0.2';
    await renderMap();
    await tapPin('v1');
    await act(async () => jest.advanceTimersByTime(250));
    expect(screen.getByTestId('explore.venueCard')).toBeTruthy();
    jest.setSystemTime(Date.now() + 3_000);
    await tapPin('v1');
    await act(async () => jest.advanceTimersByTime(250));
    expect(onOpenVenue).toHaveBeenCalledWith(laugar);
  });
});
