/**
 * "Location is off" (iOS SearchMapView `locationDeniedBanner`): it appears as
 * soon as "Don't allow" is chosen, goes once location is allowed in Settings
 * (the store re-reads when the app comes back), and Open goes where location
 * can be turned on again.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';

import { setCurrentLanguage } from '../../../i18n';
import { createBrowseSession } from '../../../stores/browseSession';
import {
  createLocationStore,
  startLocationLifecycle,
  type LocationPlatform,
  type PermissionSnapshot,
} from '../../../stores/locationStore';
import LocationDeniedBanner from '../LocationDeniedBanner';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/** A phone whose permission the test sets, as the member would in Settings. */
function fakePhone(initial: PermissionSnapshot) {
  let snapshot = initial;
  const platform: LocationPlatform = {
    getPermission: async () => snapshot,
    requestPermission: async () => snapshot,
    currentFix: async () => ({ latitude: 64.1466, longitude: -21.9426, accuracy: 20, timestamp: Date.now() }),
  };
  return {
    platform,
    set(next: PermissionSnapshot) {
      snapshot = next;
    },
  };
}

function fakeAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  return {
    currentState: 'active' as AppStateStatus,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
    emit: (state: AppStateStatus) => listeners.forEach((listener) => listener(state)),
  };
}

const refused: PermissionSnapshot = { permission: 'denied', canAskAgain: true, approximate: false, servicesEnabled: true };
const allowed: PermissionSnapshot = { permission: 'granted', canAskAgain: true, approximate: false, servicesEnabled: true };
const switchedOff: PermissionSnapshot = { ...allowed, servicesEnabled: false };

async function setup(initial: PermissionSnapshot) {
  const phone = fakePhone(initial);
  const session = createBrowseSession({ seed: 1 });
  const store = createLocationStore({ platform: phone.platform, session, suppressPrompts: () => true });
  const appState = fakeAppState();
  const stop = startLocationLifecycle({ appState, location: store, session });
  const onOpen = jest.fn();
  await render(<LocationDeniedBanner store={store} onOpen={onOpen} />);
  await act(async () => undefined);
  return { phone, store, appState, stop, onOpen };
}

it('shows after "Don\'t allow" and goes after allowing location in Settings', async () => {
  const { phone, appState, stop, onOpen } = await setup(refused);
  expect(screen.getByText('Location is off')).toBeTruthy();
  expect(screen.getByText('Turn it on in Settings to see your spot on the map')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button'));
  expect(onOpen).toHaveBeenCalledWith('permission');

  phone.set(allowed);
  await act(async () => {
    appState.emit('background');
    appState.emit('active');
  });
  await act(async () => undefined);
  expect(screen.queryByText('Location is off')).toBeNull();
  stop();
});

it('sends the member to the phone’s location settings when location is off for the phone', async () => {
  const { stop, onOpen } = await setup(switchedOff);
  await fireEvent.press(screen.getByRole('button'));
  expect(onOpen).toHaveBeenCalledWith('services');
  stop();
});

it('draws nothing while location is allowed, or before the permission has been read', async () => {
  const { stop } = await setup(allowed);
  expect(screen.queryByText('Location is off')).toBeNull();
  stop();
  const unread = createLocationStore({ platform: fakePhone(refused).platform, session: createBrowseSession({ seed: 1 }) });
  await render(<LocationDeniedBanner store={unread} />);
  expect(screen.queryByText('Location is off')).toBeNull();
});

it('speaks Icelandic', async () => {
  setCurrentLanguage('is');
  const { stop } = await setup(refused);
  expect(screen.getByText('Slökkt á staðsetningu')).toBeTruthy();
  expect(screen.getByText('Kveiktu á henni í Stillingum til að sjá þig á kortinu')).toBeTruthy();
  expect(screen.getByText('Opna')).toBeTruthy();
  stop();
});
