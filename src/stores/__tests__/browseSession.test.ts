/**
 * The browse session beyond the ported iOS cases (src/lib/__tests__/
 * browseOrder.test.ts holds those): the debug seed and the store's shape.
 */
import { renderHook, act } from '@testing-library/react-native';
import { setDev, setEnv } from '@test/harness';

import { MAX_SEED } from '../../lib/browseOrder';
import { translate } from '../../i18n';
import {
  browseSession,
  createBrowseSession,
  debugFixedSeed,
  launchSeed,
  sortLabelKey,
  useBrowseSession,
  VISIT_GAP_MS,
} from '../browseSession';

type BrowseSessionModule = typeof import('../browseSession');

it('a development build can fix the seed; a bad value is ignored', () => {
  expect(debugFixedSeed(null)).toBeNull();
  expect(debugFixedSeed()).toBeNull(); // no fixture switch
  expect(debugFixedSeed('42')).toBe(42);
  expect(debugFixedSeed(' 7 ')).toBe(7);
  expect(debugFixedSeed('4294967295')).toBe(MAX_SEED);
  expect(debugFixedSeed('4294967296')).toBeNull();
  expect(debugFixedSeed('-1')).toBeNull();
  expect(debugFixedSeed('seven')).toBeNull();
  expect(debugFixedSeed('')).toBeNull(); // a bare `browseSeed` flag
});

/**
 * The iOS `-LPBrowseSeed 42` is F0's fixture switch `browseSeed=42`, as every
 * other launch argument is: a screenshot run or device QA gets the same venue
 * order every time, and it holds across a new visit.
 */
it('a browseSeed fixture fixes the launch seed, and it is never redrawn', () => {
  setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,browseSeed=42' });
  expect(debugFixedSeed()).toBe(42);
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresh = require('../browseSession') as BrowseSessionModule;
    expect(fresh.launchSeed).toBe(42);
    const session = fresh.browseSession.getState();
    expect(session.seed).toBe(42);
    session.didEnterBackground(0);
    expect(session.didBecomeActive(2 * VISIT_GAP_MS, null)).toBe(false);
    expect(fresh.browseSession.getState().seed).toBe(42);
  });
});

it('a release build ignores the seed switch', () => {
  setEnv({ EXPO_PUBLIC_FIXTURE: 'browseSeed=42' });
  setDev(false);
  expect(debugFixedSeed()).toBeNull();
  expect(debugFixedSeed('42')).toBeNull();
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

it('the sort label claims "nearest" only with a real fix', () => {
  expect(sortLabelKey(null)).toBe('explore.sort_mixed');
  expect(sortLabelKey({ latitude: 64.1, longitude: -21.9 })).toBe('explore.sort_nearest');
  expect(translate(sortLabelKey(null), 'is')).toBe('Blandað fyrir þig');
  expect(translate(sortLabelKey({ latitude: 64.1, longitude: -21.9 }), 'en')).toBe('Nearest first');
});
