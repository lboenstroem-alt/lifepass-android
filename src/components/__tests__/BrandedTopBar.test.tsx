/**
 * The legacy top bar's person button goes somewhere from every screen that
 * draws it, including the Check-in tab, which sits directly in the tab bar
 * where no navigator registers Account. Rendered in real navigators shaped
 * like the app's TabNavigator, not a mocked navigate.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import BrandedTopBar from '../BrandedTopBar';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const Tab = createBottomTabNavigator();
const LibraryStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();

function Account() {
  return <Text>Account screen</Text>;
}

function Library() {
  return <BrandedTopBar title="Library" trailing="settings" />;
}

function Bookings() {
  return (
    <LibraryStack.Navigator screenOptions={{ headerShown: false }}>
      <LibraryStack.Screen name="BookingsMain" component={Library} />
      <LibraryStack.Screen name="Account" component={Account} />
    </LibraryStack.Navigator>
  );
}

function HomeMain() {
  return <BrandedTopBar title="Home" />;
}

function Home() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeMain} />
      <HomeStack.Screen name="Account" component={Account} />
    </HomeStack.Navigator>
  );
}

function CheckIn() {
  return <BrandedTopBar title="Studio check-in" subtitle="For your classes" />;
}

function App({ initialRouteName }: { initialRouteName: string }) {
  return (
    <NavigationContainer>
      <Tab.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Home" component={Home} />
        <Tab.Screen name="CheckIn" component={CheckIn} />
        <Tab.Screen name="Bookings" component={Bookings} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

it('on the Check-in tab (a bare tab), the person button opens Account through the tab that hosts it', async () => {
  await render(<App initialRouteName="CheckIn" />);
  expect(screen.queryByText('Account screen')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Open account' }));
  expect(await screen.findByText('Account screen')).toBeOnTheScreen();
});

it('in a stack that registers Account, it pushes Account there', async () => {
  await render(<App initialRouteName="Home" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open account' }));
  expect(await screen.findByText('Account screen')).toBeOnTheScreen();
});

it('the Library gear says Settings and opens Account', async () => {
  await render(<App initialRouteName="Bookings" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByText('Account screen')).toBeOnTheScreen();
});

it("takes iOS Scan's person button: Profile, its label, and disabled while the camera is live", async () => {
  const openProfile = jest.fn();
  function Scan({ live }: { live: boolean }) {
    return (
      <NavigationContainer>
        <Tab.Navigator screenOptions={{ headerShown: false }}>
          <Tab.Screen name="CheckIn">
            {() => (
              <BrandedTopBar title="Scan" onPersonPress={openProfile} personLabelKey="a11y.open_profile" personDisabled={live} />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    );
  }
  const view = await render(<Scan live />);
  const button = screen.getByRole('button', { name: 'Open profile: bookings and saved' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(openProfile).not.toHaveBeenCalled();

  await view.rerender(<Scan live={false} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open profile: bookings and saved' }));
  expect(openProfile).toHaveBeenCalledTimes(1);
});
