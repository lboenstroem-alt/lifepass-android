/**
 * The recent check-in Home re-offers: the app store's `recentCheckIn`, read
 * again every time the screen gains focus (iOS Home's appear), so the bar
 * shows after a check-in and goes once the server's window lapses.
 */
import { NavigationContainer, type NavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { createRef } from 'react';
import { Text } from 'react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { useAppStore } from '../../../stores/appStore';
import { freshStorePerTest, MEMBER_A, profileJSON } from '../../../stores/__tests__/storeHarness';
import { useRecentCheckIn } from '../useRecentCheckIn';

stubApiClientPerTest();
freshStorePerTest();

const RECENT = {
  checkInId: '7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77',
  checkedInAt: '2026-04-23T14:32:00Z',
  memberName: 'Anna Jonsdottir',
  memberShortName: 'Anna J.',
  venue: { id: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1', name: 'World Class Laugar' },
  activity: null,
};

let refreshOnFocus = true;

function Home() {
  const checkIn = useRecentCheckIn({ refreshOnFocus });
  return <Text>{checkIn ? `${checkIn.venue.name} / ${checkIn.memberShortName ?? '-'}` : 'none'}</Text>;
}
function Elsewhere() {
  return <Text>elsewhere</Text>;
}

const Stack = createNativeStackNavigator();
const navigationRef = createRef<NavigationContainerRef<ParamListBase>>();

async function renderHome() {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="Elsewhere" component={Elsewhere} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  refreshOnFocus = true;
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
});

it('reads the profile on focus and shows the short name, never the full one', async () => {
  api.on('GET', '/profile', Reply.ok(profileJSON({ recentCheckIn: RECENT })));
  await renderHome();
  await waitFor(() => expect(screen.getByText('World Class Laugar / Anna J.')).toBeOnTheScreen());
  expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
});

it('reads again when the screen comes back, and the bar goes once the window lapses', async () => {
  api.on('GET', '/profile', Reply.ok(profileJSON({ recentCheckIn: RECENT })));
  await renderHome();
  await waitFor(() => expect(screen.getByText('World Class Laugar / Anna J.')).toBeOnTheScreen());

  api.on('GET', '/profile', Reply.ok(profileJSON({ recentCheckIn: null })));
  await act(async () => navigationRef.current?.navigate('Elsewhere'));
  await act(async () => navigationRef.current?.goBack());
  await waitFor(() => expect(screen.getByText('none')).toBeOnTheScreen());
  expect(api.sentAll('/profile', 'GET')).toHaveLength(2);
});

it('a failed read keeps the proof that was showing', async () => {
  api.on('GET', '/profile', Reply.ok(profileJSON({ recentCheckIn: RECENT })));
  await renderHome();
  await waitFor(() => expect(screen.getByText('World Class Laugar / Anna J.')).toBeOnTheScreen());

  api.on('GET', '/profile', Reply.fail());
  await act(async () => navigationRef.current?.navigate('Elsewhere'));
  await act(async () => navigationRef.current?.goBack());
  await waitFor(() => expect(api.sentAll('/profile', 'GET')).toHaveLength(2));
  expect(screen.getByText('World Class Laugar / Anna J.')).toBeOnTheScreen();
});

it('leaves the read to a screen that already reads on focus', async () => {
  refreshOnFocus = false;
  await renderHome();
  await act(async () => undefined);
  expect(screen.getByText('none')).toBeOnTheScreen();
  expect(api.sentAll('/profile', 'GET')).toHaveLength(0);
});

it('reads nothing while signed out', async () => {
  useAppStore.setState({ isAuthenticated: false, userId: null });
  await renderHome();
  await act(async () => undefined);
  expect(api.sentAll('/profile', 'GET')).toHaveLength(0);
});
