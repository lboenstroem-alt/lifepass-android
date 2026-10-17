/**
 * Home on a small navigator for its screen tests: the Home tab's stack (Home,
 * plus stand-ins for the pages it pushes) and stand-in tabs to visit, over
 * the stub server. Location is a fake (a fix the test sets, no system
 * dialog), the weather is Open-Meteo stubbed, and every store starts fresh.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, NavigationContainer, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render } from '@testing-library/react-native';
import { http, HttpResponse, server } from '@test/server';
import { Text, View } from 'react-native';

import { setAnalyticsObserver, type AnalyticsParams } from '../../../lib/analytics';
import type { Coordinate } from '../../../lib/geo';
import { browseSession } from '../../../stores/browseSession';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../stores/intentStore';
import { locationStore } from '../../../stores/locationStore';
import { resetVenuesStore } from '../../../stores/venuesStore';
import HomeScreen from '../HomeScreen';

export const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
export const FORECAST = 'https://api.open-meteo.com/v1/forecast';

function StandIn() {
  const route = useRoute();
  return (
    <View testID={`screen.${route.name}`}>
      <Text>{`${route.name} screen`}</Text>
      <Text testID={`params.${route.name}`}>{JSON.stringify(route.params ?? null)}</Text>
    </View>
  );
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="Profile" component={StandIn} />
      <Stack.Screen name="Account" component={StandIn} />
      <Stack.Screen name="VenueDetail" component={StandIn} />
      <Stack.Screen name="AttractionDetail" component={StandIn} />
    </Stack.Navigator>
  );
}

export const homeNavigation = createNavigationContainerRef<Record<string, object | undefined>>();

export function HomeApp() {
  return (
    <NavigationContainer ref={homeNavigation}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Home" component={HomeStack} />
        <Tab.Screen name="Explore" component={StandIn} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const originalRequestLocation = locationStore.getState().requestLocation;
export const requestLocation = jest.fn(async () => undefined);
export const analytics: [string, AnalyticsParams][] = [];

/** A fresh process, signed in, no location decided, a fixed browse seed. */
export function freshHome(options: { fix?: Coordinate | null } = {}): void {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetVenuesStore();
  useAppStore.setState({ isLoading: false, isAuthenticated: true, userId: MEMBER });
  browseSession.setState({ seed: 7, origin: null, revision: browseSession.getState().revision + 1 });
  requestLocation.mockClear();
  locationStore.setState({
    permission: options.fix ? 'granted' : 'undetermined',
    permissionKnown: true,
    currentLocation: options.fix ? { ...options.fix, accuracy: 50, timestamp: Date.now() } : null,
    requestLocation,
  });
  analytics.length = 0;
  setAnalyticsObserver((event, params) => analytics.push([event, params]));
  weather({ temperature_2m: 7.2, weather_code: 3 });
}

/** Restores what `freshHome` replaced. */
export function leaveHome(): void {
  locationStore.setState({ requestLocation: originalRequestLocation, currentLocation: null, permission: 'undetermined' });
  setAnalyticsObserver(null);
}

/** What Open-Meteo answers (a body, or a status code for a failure). */
export function weather(answer: Record<string, unknown> | number): void {
  server.use(
    http.get(FORECAST, () =>
      typeof answer === 'number' ? HttpResponse.json({}, { status: answer }) : HttpResponse.json({ current: answer }),
    ),
  );
}

/** `GET /profile`'s data. */
export function profileJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMBER,
    email: 'lucas@example.com',
    fullName: 'Lucas Bönström',
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    ...extra,
  };
}

/** A `usage` block with these passes. */
export function usageWith(passes: { id: string; visitsLeft: number; expiresAt: string }[]): Record<string, unknown> {
  return {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: passes.map((pass) => ({ type: 'explorer', ...pass })),
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  };
}

/** One row of `GET /bookings`. */
export function bookingRow(id: string, startsAt: string, venueName: string): Record<string, unknown> {
  return {
    id,
    status: 'confirmed',
    startsAt,
    endsAt: startsAt,
    venue: { id: '00000000-0000-4000-8000-000000000001', slug: 'venue-1', name: venueName },
    activity: null,
    externalTitle: null,
    location: null,
    venueReference: null,
  };
}

export async function renderHome() {
  const view = await render(<HomeApp />);
  await settle();
  return view;
}

/** Lets the reads Home starts at focus land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}
