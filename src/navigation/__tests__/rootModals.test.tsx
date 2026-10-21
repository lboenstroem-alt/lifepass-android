/**
 * Pages over the tab bar, in the app's real navigators: the Plans modal with
 * the first build's top-up page (which pads itself above a tab bar), and a
 * refusal's next step taken on a root modal (iOS presents Account over the
 * refusing sheet; here the shared sheet does, and closing it lands back on
 * the modal), and a tab switch asked for while a modal is up (it leaves the
 * modal through the back guards, so a busy one holds the switch).
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { useIntentStore } from '../../stores/intentStore';
import { openRootModal } from '../navigationRef';
import { currentRouteName, currentTab, navigationRef, renderShell, signedIn } from './shellHarness';

/** The refusing page's re-check (runs when the member is back on it). */
const mockRecheck = jest.fn();

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../screens/home/HomeScreen', () => require('./standIn').standInScreen('Home'));
jest.mock('../../screens/explore/ExploreScreen', () => require('./standIn').standInScreen('Explore'));
jest.mock('../../screens/coach/CoachScreen', () => require('./standIn').standInScreen('Coach'));
// The scanners (CHECKIN-1) take a parked check-in link; the shell's tests stand them in so the link stays parked.
jest.mock('../../features/checkin/scan/ScanScreen', () => require('./standIn').standInScreen('CheckIn'));
jest.mock('../../features/checkin/scan/ScanPushedScreen', () => require('./standIn').standInScreen('ScanPushed'));
jest.mock('../../screens/bookings/BookingsScreen', () => require('./standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('./standIn').standInScreen('LegacyAccount'));
jest.mock('../../screens/venue/VenueDetailScreen', () => require('./standIn').standInScreen('LegacyVenue'));
jest.mock('../../screens/booking/BookingFlowScreen', () => require('./standIn').standInScreen('LegacyBooking'));
jest.mock('../../features/auth/screens/OnboardingScreen', () => require('./standIn').standInScreen('Onboarding'));
jest.mock('../../features/auth/screens/LoginScreen', () => require('./standIn').standInScreen('Login'));
jest.mock('../../features/auth/screens/SignUpScreen', () => require('./standIn').standInScreen('SignUp'));
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
// A review being posted: busy until "Finish" (a booking or a checkout in flight, the same guard).
jest.mock('../../features/venue/reviews/WriteReviewScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useState: mockUseState } = require('react');
  const { useBusyGuard: mockUseBusyGuard } = require('../guards');
  function PostingReview() {
    const [busy, setBusy] = mockUseState(true);
    mockUseBusyGuard(busy);
    return (
      <>
        <MockText>{busy ? 'Posting review' : 'Review posted'}</MockText>
        <MockPressable accessibilityRole="button" onPress={() => setBusy(false)}>
          <MockText>Finish</MockText>
        </MockPressable>
      </>
    );
  }
  return { __esModule: true, default: PostingReview };
});
/* eslint-enable @typescript-eslint/no-require-imports */

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

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

describe('a tab switch while a modal is up', () => {
  it('closes a modal that is not busy, then switches (iOS rebuilds the tab and its sheets)', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('ClassesDiscoveryModal');
    });
    await act(async () => useIntentStore.getState().requestTab('Plan'));
    expect(rootRoutes()).toEqual(['Main']);
    expect(currentTab()).toBe('Plan');
  });

  it('is held while the modal is busy, and performed once the work is done and the modal has closed', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('WriteReview', { venueId: VENUE, venueName: 'Laugar' });
    });
    // A check-in link arrives while the review is being posted.
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    expect(rootRoutes()).toEqual(['Main', 'WriteReview']);
    expect(screen.getByText('Posting review')).toBeOnTheScreen();
    expect(currentTab()).toBe('Explore');

    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText('Review posted')).toBeOnTheScreen();
    expect(currentTab()).toBe('Explore');

    await act(async () => navigationRef.goBack());
    expect(rootRoutes()).toEqual(['Main']);
    expect(currentTab()).toBe('Scan');
    // Still parked for the Scan screen to ask about.
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
  });

  it('to the tab already on screen leaves the modal as it is (Plan keeps its runner, as on iOS)', async () => {
    signedIn('Plan');
    await renderShell();
    await act(async () => {
      openRootModal('WorkoutRunner', { sessionId: 's-1', entry: 'today' });
    });
    await act(async () => useIntentStore.getState().requestTab('Plan'));
    expect(rootRoutes()).toEqual(['Main', 'WorkoutRunner']);
    expect(currentRouteName()).toBe('WorkoutRunner');
  });
});
