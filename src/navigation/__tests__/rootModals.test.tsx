/**
 * Pages over the tab bar, in the app's real navigators: the Plans modal with
 * the first build's top-up page (which pads itself above a tab bar), and a
 * refusal's next step taken on a root modal (iOS presents Account over the
 * refusing sheet; here the shared sheet does, and closing it lands back on
 * the modal).
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { openRootModal } from '../navigationRef';
import { currentRouteName, navigationRef, renderShell, signedIn } from './shellHarness';

/** The refusing page's re-check (runs when the member is back on it). */
const mockRecheck = jest.fn();

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../screens/home/HomeScreen', () => require('./standIn').standInScreen('Home'));
jest.mock('../../screens/explore/ExploreScreen', () => require('./standIn').standInScreen('Explore'));
jest.mock('../../screens/coach/CoachScreen', () => require('./standIn').standInScreen('Coach'));
jest.mock('../../screens/checkin/CheckInScreen', () => require('./standIn').standInScreen('CheckIn'));
jest.mock('../../screens/bookings/BookingsScreen', () => require('./standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('./standIn').standInScreen('LegacyAccount'));
jest.mock('../../screens/venue/VenueDetailScreen', () => require('./standIn').standInScreen('LegacyVenue'));
jest.mock('../../screens/booking/BookingFlowScreen', () => require('./standIn').standInScreen('LegacyBooking'));
jest.mock('../../screens/auth/OnboardingScreen', () => require('./standIn').standInScreen('Onboarding'));
jest.mock('../../screens/auth/LoginScreen', () => require('./standIn').standInScreen('Login'));
jest.mock('../../screens/auth/SignUpScreen', () => require('./standIn').standInScreen('SignUp'));
jest.mock('../../components/KenniVerificationModal', () => ({ __esModule: true, default: () => null }));
// The classes sheet's page refuses a booking: its next steps, from a root modal.
jest.mock('../../features/classes/ClassesDiscoveryModalScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useBottomTabBarHeight: mockTabBarHeight } = require('@react-navigation/bottom-tabs');
  const { useRefusalStep: mockUseRefusalStep } = require('../refusalSteps');
  function RefusingClasses() {
    const { take } = mockUseRefusalStep({ onReturn: () => mockRecheck() });
    const padding = mockTabBarHeight();
    return (
      <>
        <MockText>{`Classes, padded ${padding}`}</MockText>
        <MockPressable accessibilityRole="button" onPress={() => take('manageMembership')}>
          <MockText>Manage membership</MockText>
        </MockPressable>
        <MockPressable accessibilityRole="button" onPress={() => take('myBookings')}>
          <MockText>My bookings</MockText>
        </MockPressable>
      </>
    );
  }
  return { __esModule: true, default: RefusingClasses };
});
/* eslint-enable @typescript-eslint/no-require-imports */

const rootRoutes = () => navigationRef.getRootState().routes.map((route) => route.name);

describe('the Plans modal', () => {
  it("opens with the first build's top-up page, which pads for a tab bar that is not there", async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('Plans');
    });
    expect(currentRouteName()).toBe('Plans');
    expect(screen.getByText('Visitor passes')).toBeOnTheScreen();
  });
});

describe('a refusal on a root modal', () => {
  const recheck = mockRecheck;
  beforeEach(() => recheck.mockReset());

  it('reads no tab bar under it', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('ClassesDiscoveryModal');
    });
    // The test's safe area has no bottom inset.
    expect(screen.getByText('Classes, padded 0')).toBeOnTheScreen();
  });

  it('opens Account over the modal, and closing it lands back there and re-checks', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('ClassesDiscoveryModal');
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Manage membership' }));
    expect(currentRouteName()).toBe('Account');
    expect(rootRoutes()).toEqual(['Main', 'ClassesDiscoveryModal', 'SharedSheet']);
    expect(recheck).not.toHaveBeenCalled();

    await act(async () => navigationRef.goBack());
    expect(currentRouteName()).toBe('ClassesDiscoveryModal');
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('opens Profile on Bookings the same way', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('ClassesDiscoveryModal');
    });
    await fireEvent.press(screen.getByRole('button', { name: 'My bookings' }));
    expect(currentRouteName()).toBe('Profile');
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ initialTab: 'bookings' });
    expect(rootRoutes()).toEqual(['Main', 'ClassesDiscoveryModal', 'SharedSheet']);
  });
});
