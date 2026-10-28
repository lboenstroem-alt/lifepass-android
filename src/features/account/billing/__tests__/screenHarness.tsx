/**
 * Test set-up for ACCT-2's screens and slot: the page in a real native stack
 * pushed over a first screen, with stand-ins for the routes it opens, so a
 * test can press back or "View plans" and see where the member lands.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text, View } from 'react-native';

export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

const Stack = createNativeStackNavigator();

function routeStandIn(name: string): ComponentType {
  return function RouteStandIn() {
    return (
      <View testID={`route.${name}`}>
        <Text>{`${name} route`}</Text>
      </View>
    );
  };
}

const Start = routeStandIn('Start');
const Plans = routeStandIn('Plans');

/** `component` as the route `name`, pushed over a first screen, with Plans beside it. */
export function renderPushed(name: string, component: ComponentType<never>) {
  return render(
    <NavigationContainer ref={navigationRef} initialState={{ index: 1, routes: [{ name: 'Start' }, { name }] }}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name={name} component={component as unknown as ComponentType} />
        <Stack.Screen name="Plans" component={Plans} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/** A component (a slot) on a first screen of its own. */
export function renderInScreen(component: ComponentType) {
  return render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Host" component={component} />
        <Stack.Screen name="Other" component={routeStandIn('Other')} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/** Lets msw answers and the state they set land. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

export function currentRoute(): string | undefined {
  return navigationRef.getCurrentRoute()?.name;
}
