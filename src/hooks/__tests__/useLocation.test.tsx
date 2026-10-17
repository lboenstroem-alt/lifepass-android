/**
 * The legacy Home location hook, now a view of the location store: it asks
 * the way iOS Home does (once, while the member has not decided) and hands
 * back only a granted fix. It used to prompt on every mount.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useLocation } from '../useLocation';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(async () => true),
}));

/** Lets the store's promise chains (all microtasks here) run to the end. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

const permission = (status: Location.PermissionStatus) =>
  ({
    status,
    granted: status === Location.PermissionStatus.GRANTED,
    canAskAgain: true,
    expires: 'never',
    android: { accuracy: 'fine' },
  }) as Location.LocationPermissionResponse;

it('asks once, returns the granted fix, and never asks again', async () => {
  let current = Location.PermissionStatus.UNDETERMINED;
  jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => permission(current));
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
    current = Location.PermissionStatus.GRANTED;
    return permission(current);
  });
  jest.mocked(Location.getCurrentPositionAsync).mockImplementation(async () => ({
    coords: { latitude: 64.15, longitude: -21.94, accuracy: 30, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
  }));

  const first = await renderHook(() => useLocation());
  // The permission read, the dialog and the fix land inside act.
  await act(settle);
  expect(first.result.current).toEqual(expect.objectContaining({ latitude: 64.15, longitude: -21.94 }));
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  await first.unmount();

  // Home mounts again (a tab switch): no second dialog.
  const second = await renderHook(() => useLocation());
  await act(settle);
  expect(second.result.current).not.toBeNull();
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});
