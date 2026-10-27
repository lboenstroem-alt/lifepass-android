/**
 * Profile in a real native stack, pushed over a first screen as every person
 * button pushes it, with stand-ins for the routes it opens (Account, a venue
 * page, Plans), so a test can see where a tap went without those screens.
 */
import { createNavigationContainerRef, NavigationContainer, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text, View } from 'react-native';

import ProfileScreen from '../ProfileScreen';
import type { ProfileTab } from '../../../navigation/types';

export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

const Stack = createNativeStackNavigator();

function routeStandIn(name: string): ComponentType {
  return function RouteStandIn() {
    const route = useRoute();
    return (
      <View testID={`route.${name}`}>
        <Text>{`${name} route`}</Text>
        <Text testID={`params.${name}`}>{JSON.stringify(route.params ?? null)}</Text>
      </View>
    );
  };
}

const Start = routeStandIn('Start');
const Account = routeStandIn('Account');
const VenueDetail = routeStandIn('VenueDetail');
const AttractionDetail = routeStandIn('AttractionDetail');
const Plans = routeStandIn('Plans');

export function ProfileHarness({ initialTab = 'bookings' }: { readonly initialTab?: ProfileTab }) {
  return (
    <NavigationContainer
      ref={navigationRef}
      initialState={{ index: 1, routes: [{ name: 'Start' }, { name: 'Profile', params: { initialTab } }] }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="Profile" component={ProfileScreen as unknown as ComponentType} />
        <Stack.Screen name="Account" component={Account} />
        <Stack.Screen name="VenueDetail" component={VenueDetail} />
        <Stack.Screen name="AttractionDetail" component={AttractionDetail} />
        <Stack.Screen name="Plans" component={Plans} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** Lets msw answers and the state they set land. */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Renders Profile and lets its first loads answer. */
export async function renderProfile(initialTab: ProfileTab = 'bookings') {
  const view = await render(<ProfileHarness initialTab={initialTab} />);
  await settle();
  return view;
}

export function currentRoute(): string | undefined {
  return navigationRef.getCurrentRoute()?.name;
}
