/**
 * A refusal's "Cancel deletion" in the app's real navigators: the tabs shell
 * keeps ACCT-4's deletion sheet host mounted, so the step opens the deletion
 * sheet over the refusing screen ("Keep my account"), as iOS
 * `RefusalStepPresenter` presents `AccountDeletionSheet` for `.deletion`
 * (Views/Booking/BookingConfirmComponents.swift), and closing it re-checks
 * the refusing screen. Without the host the step fell back to the Account
 * page, which is what this file guards against.
 *
 * Nothing here is injected: the step reaches the sheet through
 * `openAccountDeletion`, as the booking sheets, Plans, Scan and My bookings do.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { DeviceEventEmitter } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { bottomSheetMock } from '../../components/ui/testing/bottomSheetMock';
import {
  isAccountDeletionHostMounted,
  resetAccountDeletionPresenterForTests,
} from '../../features/account/deletion/presenter';
import { useAppStore } from '../../stores/appStore';
import { openRootModal } from '../navigationRef';
import { takeRefusalStep } from '../refusalSteps';
import { currentRouteName, navigationRef, renderShell, signedIn } from './shellHarness';

/** The refusing page's re-check (runs when the member is back on it). */
const mockRecheck = jest.fn();

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
// The UI kit's Sheet as the library draws it: footer, portal, and `onDismiss` after a close.
jest.mock('@gorhom/bottom-sheet', () => require('../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('../../screens/home/HomeScreen', () => require('./standIn').standInScreen('Home'));
jest.mock('../../screens/explore/ExploreScreen', () => require('./standIn').standInScreen('Explore'));
jest.mock('../../screens/coach/CoachScreen', () => require('./standIn').standInScreen('Coach'));
jest.mock('../../features/checkin/scan/ScanScreen', () => require('./standIn').standInScreen('CheckIn'));
jest.mock('../../features/checkin/scan/ScanPushedScreen', () => require('./standIn').standInScreen('ScanPushed'));
jest.mock('../../features/library/ProfileScreen', () => require('./standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('./standIn').standInScreen('LegacyAccount'));
jest.mock('../../screens/venue/VenueDetailScreen', () => require('./standIn').standInScreen('LegacyVenue'));
jest.mock('../../screens/booking/BookingFlowScreen', () => require('./standIn').standInScreen('LegacyBooking'));
jest.mock('../../features/auth/screens/OnboardingScreen', () => require('./standIn').standInScreen('Onboarding'));
jest.mock('../../features/auth/screens/LoginScreen', () => require('./standIn').standInScreen('Login'));
jest.mock('../../features/auth/screens/SignUpScreen', () => require('./standIn').standInScreen('SignUp'));
jest.mock('../../components/KenniVerificationModal', () => ({ __esModule: true, default: () => null }));
// The classes sheet's page refuses a booking because the account is pending deletion.
jest.mock('../../features/classes/ClassesDiscoveryModalScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useRefusalStep: mockUseRefusalStep } = require('../refusalSteps');
  function RefusingClasses() {
    const { take } = mockUseRefusalStep({ onReturn: () => mockRecheck() });
    return (
      <MockPressable accessibilityRole="button" onPress={() => take('cancelDeletion')}>
        <MockText>Cancel deletion</MockText>
      </MockPressable>
    );
  }
  return { __esModule: true, default: RefusingClasses };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const PENDING = {
  accountStatus: 'deletion_pending',
  deletionRequestedAt: '2026-10-17T09:12:44.120Z',
  erasureScheduledAt: '2026-11-10T00:00:00.000Z',
  obligations: [],
};

const rootRoutes = () => navigationRef.getRootState().routes.map((route) => route.name);

beforeEach(() => {
  mockRecheck.mockReset();
  bottomSheetMock.reset();
  resetAccountDeletionPresenterForTests();
  api.on('GET', '/account/deletion', Reply.ok(PENDING));
});

afterEach(() => {
  resetAccountDeletionPresenterForTests();
});

it('the tabs shell mounts the deletion sheet host, and a sign-out takes it away', async () => {
  signedIn();
  expect(isAccountDeletionHostMounted()).toBe(false);
  await renderShell();
  expect(isAccountDeletionHostMounted()).toBe(true);

  await act(async () => useAppStore.setState({ isAuthenticated: false, userId: null }));
  expect(isAccountDeletionHostMounted()).toBe(false);
});

it('a "Cancel deletion" step from the shell opens the deletion sheet, not the Account page', async () => {
  signedIn();
  await renderShell();
  const onClosed = jest.fn();
  let outcome: string | undefined;
  await act(async () => {
    outcome = takeRefusalStep('cancelDeletion', { navigation: navigationRef as never }, { onClosed });
  });
  expect(outcome).toBe('deletionSheet');
  expect(currentRouteName()).not.toBe('Account');
  expect(rootRoutes()).toEqual(['Main']);
  expect(await screen.findByTestId('deletion.keep')).toBeOnTheScreen();
  expect(onClosed).not.toHaveBeenCalled();

  await act(async () => void DeviceEventEmitter.emit('hardwareBackPress'));
  expect(screen.queryByTestId('deletion.pending')).toBeNull();
  expect(onClosed).toHaveBeenCalledTimes(1);
});

it('on a refusing modal, opens "Keep my account" over it; back closes the sheet, not the modal, and re-checks once', async () => {
  signedIn();
  await renderShell();
  await act(async () => {
    openRootModal('ClassesDiscoveryModal');
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel deletion' }));

  expect(await screen.findByTestId('deletion.keep')).toBeOnTheScreen();
  expect(api.sentAll('/account/deletion')).toHaveLength(1);
  expect(currentRouteName()).toBe('ClassesDiscoveryModal');
  expect(rootRoutes()).toEqual(['Main', 'ClassesDiscoveryModal']);
  expect(mockRecheck).not.toHaveBeenCalled();

  await act(async () => void DeviceEventEmitter.emit('hardwareBackPress'));
  expect(screen.queryByTestId('deletion.pending')).toBeNull();
  expect(currentRouteName()).toBe('ClassesDiscoveryModal');
  expect(mockRecheck).toHaveBeenCalledTimes(1);
});
