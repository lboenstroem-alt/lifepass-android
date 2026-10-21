/**
 * Test set-up for the Account screen: a member in the app store (built from
 * the API's own JSON through the real decoders), the screen in a real
 * native stack with stand-ins for the routes it opens, and stand-ins for the
 * slots other packages fill, so a test can see where each one is mounted
 * without depending on those packages' code.
 *
 *   jest.mock('../slots/IdentityRow', () => require('./harness').slotStandIn('IdentityRow'));
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text, View } from 'react-native';

import AccountScreen from '../AccountScreen';

export * from './members';

/** A slot's stand-in: its name in brackets, findable as `slot.<name>`. */
export function slotStandIn(name: string) {
  function SlotStandIn() {
    return <Text testID={`slot.${name}`}>{`[${name}]`}</Text>;
  }
  return { __esModule: true, default: SlotStandIn };
}

// ---------------------------------------------------------------------------
// The screen in a stack

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
const Receipts = routeStandIn('Receipts');
const PlanUsage = routeStandIn('PlanUsage');
const Plans = routeStandIn('Plans');

/** Account pushed over a first screen, with the routes it opens. */
export function AccountHarness() {
  return (
    <NavigationContainer
      ref={navigationRef}
      initialState={{ index: 1, routes: [{ name: 'Start' }, { name: 'Account' }] }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="Account" component={AccountScreen as unknown as ComponentType} />
        <Stack.Screen name="Receipts" component={Receipts} />
        <Stack.Screen name="PlanUsage" component={PlanUsage} />
        <Stack.Screen name="Plans" component={Plans} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** Renders Account and lets its first reads (company context, referral) answer. */
export async function renderAccount() {
  const view = await render(<AccountHarness />);
  await settle();
  return view;
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

/** What TalkBack reads for every row and slot of a section, top to bottom. */
export function rowsOf(sectionTestId: string): string[] {
  const section = screen.getByTestId(sectionTestId);
  const found: string[] = [];
  const walk = (node: { props: Record<string, unknown>; children: unknown[] }) => {
    const id = node.props.testID;
    if (typeof id === 'string' && id.startsWith('slot.')) {
      found.push(`[${id.slice('slot.'.length)}]`);
      return;
    }
    if (typeof id === 'string' && id.startsWith('account.row.')) {
      found.push(String(node.props.accessibilityLabel));
      return;
    }
    for (const child of node.children) {
      if (typeof child === 'object' && child !== null) walk(child as never);
    }
  };
  walk(section as never);
  return found;
}
