/**
 * "Near me" at submit (iOS `CoachViewModel.resolveLocationFix`): the fix
 * there is, or one that arrives within 4 s; nothing when location is
 * refused (at once, not after 4 s); only a fix with permission granted
 * counts.
 */
import { createStore } from 'zustand/vanilla';

import type { LocationState } from '../../../../stores/locationStore';
import { PLAN_LOCATION_WAIT_MS, resolvePlanLocation, warmPlanLocation } from '../location';

const FIX = { latitude: 64.14657, longitude: -21.94263, accuracy: 20, timestamp: 0 };

function fakeStore(initial: Partial<LocationState>) {
  const requestLocation = jest.fn(async () => undefined);
  const store = createStore<LocationState>()(() => ({
    permission: 'undetermined',
    permissionKnown: false,
    canAskAgain: true,
    approximate: false,
    servicesEnabled: true,
    currentLocation: null,
    refreshPermission: async () => undefined,
    requestLocation,
    refreshIfAuthorized: async () => undefined,
    ...initial,
  }));
  return { store, requestLocation };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('waits 4 seconds, as iOS', () => {
  expect(PLAN_LOCATION_WAIT_MS).toBe(4000);
});

it('a granted fix already there answers at once, without asking again', async () => {
  const { store, requestLocation } = fakeStore({ permission: 'granted', permissionKnown: true, currentLocation: FIX });
  await expect(resolvePlanLocation(store)).resolves.toEqual({ latitude: FIX.latitude, longitude: FIX.longitude });
  expect(requestLocation).not.toHaveBeenCalled();
});

it('asks for a fix and takes one that arrives in time (the dialog may still be up)', async () => {
  const { store, requestLocation } = fakeStore({});
  const pending = resolvePlanLocation(store);
  expect(requestLocation).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1500);
  store.setState({ permission: 'granted', permissionKnown: true, currentLocation: FIX });
  await expect(pending).resolves.toEqual({ latitude: FIX.latitude, longitude: FIX.longitude });
});

it('gives up after 4 seconds without a fix', async () => {
  const { store } = fakeStore({ permission: 'granted', permissionKnown: true });
  const pending = resolvePlanLocation(store);
  let settled: unknown = 'pending';
  void pending.then((value) => {
    settled = value;
  });
  jest.advanceTimersByTime(PLAN_LOCATION_WAIT_MS - 1);
  await Promise.resolve();
  expect(settled).toBe('pending');
  jest.advanceTimersByTime(1);
  await expect(pending).resolves.toBeNull();
});

it('refused location answers null at once (already refused, or refused in the dialog)', async () => {
  const already = fakeStore({ permission: 'denied', permissionKnown: true });
  await expect(resolvePlanLocation(already.store)).resolves.toBeNull();

  const inDialog = fakeStore({});
  const pending = resolvePlanLocation(inDialog.store);
  inDialog.store.setState({ permission: 'denied', permissionKnown: true });
  await expect(pending).resolves.toBeNull();
});

it('a fix kept from before permission was taken away does not count', async () => {
  const { store } = fakeStore({ permission: 'denied', permissionKnown: true, currentLocation: FIX });
  await expect(resolvePlanLocation(store)).resolves.toBeNull();
});

it('warming asks for a fix and swallows a failure', () => {
  const { store, requestLocation } = fakeStore({});
  requestLocation.mockRejectedValueOnce(new Error('no provider'));
  expect(() => warmPlanLocation(store)).not.toThrow();
  expect(requestLocation).toHaveBeenCalledTimes(1);
});
