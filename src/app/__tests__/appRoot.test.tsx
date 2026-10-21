/**
 * The app root: the launch screen until the session is resolved and launch
 * has chosen its tab, then the sign-in screens or the tabs; and nothing asks
 * for notification permission at launch (iOS asks only in context).
 */
import { act, render, screen } from '@testing-library/react-native';

import { notificationsState } from '@test/mocks/expoNotifications';

import App, { resetLaunchForTests } from '../../../App';
import { stubApiClientPerTest } from '../../api/testing';
import { resetNavPrefsForTests, useNavPrefs } from '../../navigation/navPrefs';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { resetIntentStoreForTests } from '../../stores/intentStore';
import * as locationStore from '../../stores/locationStore';
import { resetDeepLinksForTests } from '../deepLinks';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

// The first build's auth service builds its OAuth redirect at load, which needs a manifest Jest has not got.
jest.mock('../../features/auth/authCallback', () => ({ handleAuthCallback: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../features/auth/screens/OnboardingScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Onboarding'));
jest.mock('../../features/auth/screens/LoginScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Login'));
jest.mock('../../features/auth/screens/SignUpScreen', () => require('../../navigation/__tests__/standIn').standInScreen('SignUp'));
// The first build's screens read the network or native views at load; the root only needs them to exist.
jest.mock('../../screens/home/HomeScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Home'));
jest.mock('../../screens/explore/ExploreScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Explore'));
jest.mock('../../screens/coach/CoachScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Coach'));
jest.mock('../../screens/checkin/CheckInScreen', () => require('../../navigation/__tests__/standIn').standInScreen('CheckIn'));
jest.mock('../../screens/bookings/BookingsScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Account'));
jest.mock('../../screens/account/TopUpScreen', () => require('../../navigation/__tests__/standIn').standInScreen('TopUp'));
jest.mock('../../screens/venue/VenueDetailScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Venue'));
jest.mock('../../screens/booking/BookingFlowScreen', () => require('../../navigation/__tests__/standIn').standInScreen('Booking'));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

beforeEach(() => {
  resetLaunchForTests();
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetNavPrefsForTests();
  resetDeepLinksForTests();
});

afterEach(() => {
  resetAppStoreForTests();
});

it('shows the launch screen, then the sign-in screens for a phone with no member', async () => {
  await render(<App />);
  for (let i = 0; i < 20 && (useAppStore.getState().isLoading || useNavPrefs.getState().launchTab === null); i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  expect(useNavPrefs.getState().launchTab).toBe('Explore');
  expect(screen.getByText('Onboarding screen')).toBeOnTheScreen();
  expect(screen.queryByTestId('launch-screen')).toBeNull();
});

it('never asks for notification permission at launch', async () => {
  await render(<App />);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(notificationsState.requestCount()).toBe(0);
});

it('starts location at launch, whichever tab opens first (F6)', async () => {
  const stop = jest.fn();
  const start = jest.spyOn(locationStore, 'startLocationAtLaunch').mockReturnValue(stop);
  const view = await render(<App />);
  expect(start).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
  start.mockRestore();
});
