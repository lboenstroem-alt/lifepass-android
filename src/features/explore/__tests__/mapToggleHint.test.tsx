/**
 * The Map/List switch's one-time emphasis (iOS 2.5.4): ExploreLaunchTests'
 * testTheMapListEmphasisNeverCompetesWithASheet, and the run itself: after
 * 0.6 s, about four seconds, counted only when it runs its course or the
 * switch is tapped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import {
  MAP_TOGGLE_HINT_KEY,
  MAP_TOGGLE_HINT_TIMING,
  mayRunMapToggleHint,
  useMapToggleHint,
  type MapToggleHintConditions,
} from '../mapToggleHint';

describe('when it may run (iOS MapToggleHint.mayRun)', () => {
  const may = (overrides: Partial<MapToggleHintConditions> = {}) =>
    mayRunMapToggleHint({
      alreadyShown: false,
      venuesOnScreen: true,
      kennitalaPromptPending: false,
      sheetOrPushOpen: false,
      appActive: true,
      ...overrides,
    });

  it('never competes with a sheet', () => {
    expect(may()).toBe(true);
    expect(may({ kennitalaPromptPending: true })).toBe(false); // the Kenni prompt is up
    expect(may({ sheetOrPushOpen: true })).toBe(false); // a sight card or a pushed page is up
    expect(may({ appActive: false })).toBe(false); // the app is in the background
    expect(may({ venuesOnScreen: false })).toBe(false); // Classes is showing
    expect(may({ alreadyShown: true })).toBe(false); // once is enough
    expect(MAP_TOGGLE_HINT_KEY).toBe('explore.mapToggleHinted');
  });
});

describe('the run', () => {
  const free = { venuesOnScreen: true, kennitalaPromptPending: false, sheetOrPushOpen: false, appActive: true };
  const { settleMs, stillMs } = MAP_TOGGLE_HINT_TIMING;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function mount(conditions = free, reduceMotion = false) {
    const hook = await renderHook((props: { conditions: typeof free; reduceMotion: boolean }) =>
      useMapToggleHint(props.conditions, props.reduceMotion), { initialProps: { conditions, reduceMotion } });
    // The stored flag is read.
    await act(async () => undefined);
    return hook;
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it('starts after the screen settles, lasts about four seconds, and is then remembered', async () => {
    const { result } = await mount();
    await advance(settleMs - 1);
    expect(result.current.active).toBe(false);
    await advance(1);
    expect(result.current.active).toBe(true);
    await advance(stillMs - 1);
    expect(result.current.active).toBe(true);
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBeNull();
    await advance(1);
    expect(result.current.active).toBe(false);
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBe('true');
  });

  it('runs the same four seconds as a still ring with Remove animations on', async () => {
    const { result } = await mount(free, true);
    await advance(settleMs + stillMs - 1);
    expect(result.current.active).toBe(true);
    // No pulse: the ring stands still.
    expect((result.current.pulse as unknown as { __getValue(): number }).__getValue()).toBe(0);
    await advance(1);
    expect(result.current.active).toBe(false);
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBe('true');
  });

  it('hides without counting when a sheet interrupts it, and starts again once it is gone', async () => {
    const { result, rerender } = await mount();
    await advance(settleMs + 1_000);
    expect(result.current.active).toBe(true);
    await rerender({ conditions: { ...free, sheetOrPushOpen: true }, reduceMotion: false });
    expect(result.current.active).toBe(false);
    await advance(10_000);
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBeNull();
    await rerender({ conditions: free, reduceMotion: false });
    await advance(settleMs);
    expect(result.current.active).toBe(true);
  });

  it('counts a tap on the switch, and hides at once', async () => {
    const { result } = await mount();
    await advance(settleMs);
    await act(async () => result.current.onToggleTapped());
    expect(result.current.active).toBe(false);
    expect(await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)).toBe('true');
    await advance(10_000);
    expect(result.current.active).toBe(false);
  });

  it('never runs again once shown', async () => {
    await AsyncStorage.setItem(MAP_TOGGLE_HINT_KEY, 'true');
    const { result } = await mount();
    await advance(10_000);
    expect(result.current.active).toBe(false);
  });

  it('waits while the Kenni prompt is pending', async () => {
    const { result, rerender } = await mount({ ...free, kennitalaPromptPending: true });
    await advance(10_000);
    expect(result.current.active).toBe(false);
    await rerender({ conditions: free, reduceMotion: false });
    await advance(settleMs);
    expect(result.current.active).toBe(true);
  });
});
