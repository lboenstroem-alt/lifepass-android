/**
 * The Explore screen (iOS SearchMapView): the shell, the launch presentation,
 * the Map/List switch and what it says to TalkBack, the debounced search, the
 * load failure, the filters, the list, the sights intent and the location
 * banner. Rendered in a real stack; the map, the classes feed and the sights
 * group are their packages' slots, stood in for here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNavigationContainerRef, NavigationContainer, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { decodeVenue, type VenueQuery } from '../../../api/venues';
import { UiKitProvider } from '../../../components/ui';
import { setCurrentLanguage } from '../../../i18n';
import { setAnalyticsObserver } from '../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { createBrowseSession } from '../../../stores/browseSession';
import { resetIntentStoreForTests, useIntentStore } from '../../../stores/intentStore';
import { locationStore } from '../../../stores/locationStore';
import type { Venue } from '../../../types/venue';
import { createExploreVenues, SEARCH_DEBOUNCE_MS, type ExploreVenues } from '../exploreVenues';
import ExploreScreen from '../ExploreScreen';
import { MAP_TOGGLE_HINT_KEY } from '../mapToggleHint';

// Icons load their font through expo-asset, which jest resolves from expo's own copy.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-video', () => {
  const { View: MockView } = require('react-native');
  return {
    useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), loop: false, muted: false }),
    VideoView: (props: object) => <MockView {...props} />,
  };
});

jest.mock('../map/ExploreMap', () => {
  const { Pressable: MockPressable, Text: MockText, View: MockView } = require('react-native');
  return {
    __esModule: true,
    default: (props: {
      venues: readonly { slug: string; name: string }[];
      onOpenVenue: (venue: unknown) => void;
      onOpenSight: (slug: string) => void;
      showSightsOnOpen?: boolean;
    }) => (
      <MockView>
        <MockText testID="map.venues">{props.venues.map((v) => v.name).join(', ')}</MockText>
        <MockText testID="map.sights">{props.showSightsOnOpen ? 'sights on open' : 'plain'}</MockText>
        <MockPressable onPress={() => props.onOpenVenue(props.venues[0])}>
          <MockText>Second tap on the first pin</MockText>
        </MockPressable>
      </MockView>
    ),
  };
});

jest.mock('../../classes/ClassesDiscovery', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  return {
    __esModule: true,
    default: (props: { showsModeToggle: boolean; onShowVenues?: () => void }) => (
      <MockPressable onPress={props.onShowVenues}>
        <MockText>{`Classes feed, toggle ${props.showsModeToggle ? 'shown' : 'hidden'}`}</MockText>
      </MockPressable>
    ),
  };
});

jest.mock('../../attractions/SightsSearchGroup', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  return {
    __esModule: true,
    default: (props: { query: string; onOpenSight: (slug: string) => void }) => (
      <MockPressable onPress={() => props.onOpenSight('thingvellir')}>
        <MockText>{`Sights for ${props.query}`}</MockText>
      </MockPressable>
    ),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

function venue(n: number, name: string, extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `v${n}`,
    name,
    inBundle: true,
    city: 'Reykjavík',
    coordinates: { latitude: 64.1 + n / 100, longitude: -21.9 },
    ...extra,
  });
}

const catalog = [
  venue(1, 'Laugar Gym', { categories: ['Gym', 'Sauna'], walkInsAllowed: true }),
  venue(2, 'Sky Spa', { inBundle: false, surchargePrice: 3990, categories: ['Spa'] }),
  venue(3, 'Sundhöllin', { categories: ['Pool'], coordinates: null }),
];

type Fetch = (query: VenueQuery, options: { signal?: AbortSignal }) => Promise<Venue[]>;

let explore: ExploreVenues;
let fetchMock: jest.Mock<ReturnType<Fetch>, Parameters<Fetch>>;
const requestLocation = jest.fn(async () => undefined);
const originalRequestLocation = locationStore.getState().requestLocation;

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<ParamListBase>();

function Place({ route }: NativeStackScreenProps<ParamListBase>) {
  return <Text>{`${route.name} ${JSON.stringify(route.params)}`}</Text>;
}

function App() {
  return (
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ExploreMain">{() => <ExploreScreen venues={explore} />}</Stack.Screen>
          <Stack.Screen name="VenueDetail" component={Place} />
          <Stack.Screen name="AttractionDetail" component={Place} />
          <Stack.Screen name="Profile" component={Place} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>
  );
}

async function renderExplore() {
  const view = await render(<App />);
  await act(async () => undefined);
  return view;
}

beforeEach(async () => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  // The emphasis has run already unless a test says otherwise.
  await AsyncStorage.setItem(MAP_TOGGLE_HINT_KEY, 'true');
  fetchMock = jest.fn(async (query: VenueQuery, _options: { signal?: AbortSignal }) =>
    query.search ? catalog.filter((v) => v.name.toLowerCase().includes(query.search!.toLowerCase())) : catalog,
  );
  explore = createExploreVenues({ fetch: fetchMock, session: createBrowseSession({ seed: 1 }) });
  locationStore.setState({ requestLocation, permission: 'granted', permissionKnown: true });
});

afterEach(() => {
  locationStore.setState({ requestLocation: originalRequestLocation, permission: 'undetermined', permissionKnown: false });
  setAnalyticsObserver(null);
  jest.useRealTimers();
});

describe('the shell', () => {
  it('opens on the map with the title, the venue count, and asks for location', async () => {
    await renderExplore();
    expect(screen.getByText('EXPLORE')).toBeTruthy();
    expect(screen.getByText('3 VENUES')).toBeTruthy();
    expect(screen.getByTestId('explore.map')).toBeTruthy();
    // The map shows the venues with a position only.
    expect(screen.getByTestId('map.venues').props.children).not.toContain('Sundhöllin');
    expect(fetchMock).toHaveBeenCalledWith({ limit: 100 }, expect.anything());
    expect(requestLocation).toHaveBeenCalled();
    expect(screen.queryByTestId('explore.filters.panel')).toBeNull();
  });

  it('opens Profile on its bookings from the person button, and says so', async () => {
    const events: [string, object][] = [];
    setAnalyticsObserver((event, params) => events.push([event, params]));
    await renderExplore();
    await fireEvent.press(screen.getByLabelText('Open profile: bookings and saved'));
    await act(async () => undefined);
    expect(screen.getByText('Profile {"initialTab":"bookings"}')).toBeTruthy();
    expect(events).toContainEqual(['profile_opened', { entry: 'explore' }]);
  });

  it('opens a venue by its slug', async () => {
    await renderExplore();
    await fireEvent.press(screen.getByText('Second tap on the first pin'));
    await act(async () => undefined);
    expect(screen.getByText(/^VenueDetail \{"slug":"v\d"\}$/)).toBeTruthy();
  });

  it('labels the Map/List switch by where it goes, in English and Icelandic', async () => {
    await renderExplore();
    const toggle = screen.getByTestId('explore.mapListToggle');
    expect(toggle.props.accessibilityLabel).toBe('Show list');
    await fireEvent.press(toggle);
    expect(screen.getByTestId('explore.mapListToggle').props.accessibilityLabel).toBe('Show map');
    await act(async () => setCurrentLanguage('is'));
    expect(screen.getByTestId('explore.mapListToggle').props.accessibilityLabel).toBe('Sýna kort');
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.getByTestId('explore.mapListToggle').props.accessibilityLabel).toBe('Sýna lista');
    expect(screen.getByText('SKOÐA')).toBeTruthy();
    expect(screen.getByPlaceholderText('Leita að stöðum, tímum, borgum…')).toBeTruthy();
  });
});

describe('the launch presentation', () => {
  it('opens the venues with the filters once, after a cold launch onto Explore', async () => {
    useIntentStore.getState().setExploreLaunchPresentation(true);
    await renderExplore();
    expect(screen.getByTestId('explore.filters.panel')).toBeTruthy();
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);
    // Closed by the member, it stays closed when Explore appears again.
    await fireEvent.press(screen.getByTestId('explore.filters'));
    await fireEvent.press(screen.getByText('Second tap on the first pin'));
    await act(async () => undefined);
    await act(async () => navigationRef.goBack());
    expect(navigationRef.getCurrentRoute()?.name).toBe('ExploreMain');
    expect(screen.queryByTestId('explore.filters.panel')).toBeNull();
  });

  it('never opens the filters when something took the member elsewhere first', async () => {
    useIntentStore.getState().cancelExploreLaunchPresentation();
    useIntentStore.getState().setExploreLaunchPresentation(true);
    await renderExplore();
    expect(screen.queryByTestId('explore.filters.panel')).toBeNull();
  });
});

describe('the search', () => {
  it('sends one request 300 ms after the last keystroke, and the count follows it', async () => {
    jest.useFakeTimers();
    await renderExplore();
    fetchMock.mockClear();
    const box = screen.getByTestId('explore.search');
    for (const text of ['s', 'sk', 'sky']) await fireEvent.changeText(box, text);
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toEqual({ search: 'sky', limit: 100 });
    expect(screen.getByText('1 VENUES')).toBeTruthy();
    expect(screen.getByText('Sights for sky')).toBeTruthy();
  });

  it('a sight opened from the search steps its group aside until the query changes', async () => {
    jest.useFakeTimers();
    await renderExplore();
    await fireEvent.changeText(screen.getByTestId('explore.search'), 'thing');
    await fireEvent.press(screen.getByText('Sights for thing'));
    await act(async () => undefined);
    expect(screen.getByText('AttractionDetail {"slug":"thingvellir"}')).toBeTruthy();
  });
});

describe('a failed load', () => {
  it('shows the error with a retry when no venue is on screen, and a retry that works clears it', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderExplore();
    expect(screen.getByTestId('explore.venues.error')).toBeTruthy();
    expect(screen.getByText("We couldn't load the venues. Check your connection and try again.")).toBeTruthy();
    fetchMock.mockResolvedValue(catalog);
    await fireEvent.press(screen.getByLabelText('Try again'));
    await act(async () => undefined);
    expect(screen.queryByTestId('explore.venues.error')).toBeNull();
    expect(screen.getByTestId('explore.map')).toBeTruthy();
  });

  it('says so in Icelandic', async () => {
    setCurrentLanguage('is');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderExplore();
    expect(screen.getByText('Ekki tókst að sækja staðina. Athugaðu nettenginguna og reyndu aftur.')).toBeTruthy();
    expect(screen.getByLabelText('Reyna aftur')).toBeTruthy();
  });
});

describe('the filters', () => {
  it('counts over the search results, badges what is on, and clears', async () => {
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explore.filters'));
    expect(screen.getByTestId('explore.class.premium')).toHaveTextContent('Premium1');
    expect(screen.getByTestId('explore.class.inBundle')).toHaveTextContent('In your plan2');
    await fireEvent.press(screen.getByTestId('explore.class.premium'));
    expect(screen.getByTestId('explore.filters.badge', { includeHiddenElements: true })).toHaveTextContent('1');
    expect(screen.getByTestId('map.venues').props.children).toBe('Sky Spa');

    await fireEvent.press(screen.getByTestId('explore.group.wellness'));
    await fireEvent.press(screen.getByTestId('explore.category.spa'));
    expect(screen.getByTestId('explore.filters.badge', { includeHiddenElements: true })).toHaveTextContent('2');
    // Tapping the active category's group clears it and closes the row.
    await fireEvent.press(screen.getByTestId('explore.group.wellness'));
    expect(screen.getByTestId('explore.filters.badge', { includeHiddenElements: true })).toHaveTextContent('1');
    expect(screen.queryByTestId('explore.group.wellness.row')).toBeNull();

    await fireEvent.press(screen.getByTestId('explore.filters.clear'));
    expect(screen.queryByTestId('explore.filters.badge', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('explore.filters.clear')).toBeNull();
  });

  it('switches to the classes feed and back from the panel', async () => {
    useIntentStore.getState().setExploreLaunchPresentation(true);
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explore.mode.classes'));
    expect(screen.getByText('Classes feed, toggle shown')).toBeTruthy();
    expect(screen.queryByTestId('explore.search')).toBeNull();
    expect(screen.getByText('EXPLORE')).toBeTruthy();
    await fireEvent.press(screen.getByText('Classes feed, toggle shown'));
    expect(screen.getByTestId('explore.search')).toBeTruthy();
  });
});

describe('the list', () => {
  it('shows the count, the sort label, and the rows; a row opens its venue', async () => {
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.getByTestId('explore.list.count')).toHaveTextContent('3 VENUES');
    // No band origin in this session: the order is the visit's mix.
    expect(screen.getByTestId('explore.list.sort')).toHaveTextContent('MIXED FOR YOU');
    // Venues without a position are listed.
    expect(screen.getByText('Sundhöllin')).toBeTruthy();
    expect(screen.getByText('Reykjavík · Walk-ins')).toBeTruthy();
    expect(screen.getByTestId('explore.row.v2.premium', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('explore.row.v1.premium', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(screen.getByTestId('explore.row.v3'));
    await act(async () => undefined);
    expect(screen.getByText('VenueDetail {"slug":"v3"}')).toBeTruthy();
  });

  it('says Nearest first only with a real fix', async () => {
    explore = createExploreVenues({
      fetch: fetchMock,
      session: createBrowseSession({ seed: 1, origin: { latitude: 64.14, longitude: -21.94 } }),
    });
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.getByTestId('explore.list.sort')).toHaveTextContent('NEAREST FIRST');
  });
});

describe('Home’s "See all on the map"', () => {
  it('opens the map with the sights, even from the list', async () => {
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.queryByTestId('explore.map')).toBeNull();
    await act(async () => useIntentStore.getState().requestExploreSights());
    expect(screen.getByTestId('map.sights')).toHaveTextContent('sights on open');
    expect(useIntentStore.getState().pendingExploreSights).toBe(false);
    // Moving on: the next map is a plain one.
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.getByTestId('map.sights')).toHaveTextContent('plain');
  });
});

describe('location', () => {
  it('shows "Location is off" over the map while location is refused', async () => {
    await renderExplore();
    expect(screen.queryByTestId('explore.locationOff')).toBeNull();
    await act(async () => locationStore.setState({ permission: 'denied', permissionKnown: true, servicesEnabled: true }));
    expect(screen.getByText('Location is off')).toBeTruthy();
    expect(screen.getByText('Turn it on in Settings to see your spot on the map')).toBeTruthy();
    // Not over the list: the banner belongs to the map.
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.queryByTestId('explore.locationOff')).toBeNull();
    await act(async () => locationStore.setState({ permission: 'granted' }));
    await fireEvent.press(screen.getByTestId('explore.mapListToggle'));
    expect(screen.queryByTestId('explore.locationOff')).toBeNull();
  });
});

describe('the Map/List emphasis', () => {
  it('shows the word after the screen settles, once, and never over the Kenni prompt', async () => {
    await AsyncStorage.removeItem(MAP_TOGGLE_HINT_KEY);
    useAppStore.setState({ pendingKennitalaPrompt: true });
    jest.useFakeTimers();
    await renderExplore();
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(screen.queryByTestId('explore.mapListToggle.hint')).toBeNull();

    await act(async () => useAppStore.setState({ pendingKennitalaPrompt: false }));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('explore.mapListToggle.hint')).toHaveTextContent('List');
    await act(async () => {
      jest.advanceTimersByTime(4_000);
    });
    expect(screen.queryByTestId('explore.mapListToggle.hint')).toBeNull();
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBe('true');
  });
});
