/**
 * The browse session beyond the ported iOS cases (src/lib/__tests__/
 * browseOrder.test.ts holds those): the debug seed and the store's shape.
 */
import { renderHook, act } from '@testing-library/react-native';

import { MAX_SEED } from '../../lib/browseOrder';
import { browseSession, createBrowseSession, debugFixedSeed, launchSeed, useBrowseSession } from '../browseSession';

it('a development build can fix the seed; a bad value is ignored', () => {
  expect(debugFixedSeed(undefined)).toBeNull();
  expect(debugFixedSeed('42')).toBe(42);
  expect(debugFixedSeed(' 7 ')).toBe(7);
  expect(debugFixedSeed('4294967295')).toBe(MAX_SEED);
  expect(debugFixedSeed('4294967296')).toBeNull();
  expect(debugFixedSeed('-1')).toBeNull();
  expect(debugFixedSeed('seven')).toBeNull();
});

it('the launch seed is an unsigned 32-bit integer and the shared session starts with it', () => {
  expect(Number.isInteger(launchSeed)).toBe(true);
  expect(launchSeed).toBeGreaterThanOrEqual(0);
  expect(launchSeed).toBeLessThanOrEqual(MAX_SEED);
  expect(browseSession.getState().seed).toBe(launchSeed);
});

it('a drawn seed is kept unsigned', () => {
  const visit = createBrowseSession({ seed: -1, drawSeed: () => -2 });
  expect(visit.getState().seed).toBe(MAX_SEED);
  visit.getState().didEnterBackground(0);
  visit.getState().didBecomeActive(60 * 60 * 1000, null);
  expect(visit.getState().seed).toBe(MAX_SEED - 1);
});

it('a screen re-renders when the visit changes', async () => {
  const visit = createBrowseSession({ seed: 1 });
  const { result } = await renderHook(() => useBrowseSession((state) => state.revision, visit));
  expect(result.current).toBe(0);
  await act(async () => visit.getState().locationDidChange({ latitude: 64, longitude: -21 }));
  expect(result.current).toBe(1);
});
