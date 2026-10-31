import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { androidCueFor, haptics, type HapticCue } from '../haptics';

// expo-haptics 15 never rejects performAndroidHapticsAsync (it does not await
// the native call), so the mock resolves too: the constant has to be right
// the first time.
jest.mock('expo-haptics', () => {
  const actual = jest.requireActual('expo-haptics');
  return {
    ...actual,
    performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
    impactAsync: jest.fn(() => Promise.resolve()),
    notificationAsync: jest.fn(() => Promise.resolve()),
    selectionAsync: jest.fn(() => Promise.resolve()),
  };
});

const perform = Haptics.performAndroidHapticsAsync as jest.Mock;
const { AndroidHaptics } = Haptics;

/** Lets the fire-and-forget promise chain run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const versionDescriptor = Object.getOwnPropertyDescriptor(Platform, 'Version')!;

/** Runs the test as a phone at this API level. */
function onApiLevel(level: number) {
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => level });
}

beforeEach(() => {
  perform.mockImplementation(() => Promise.resolve());
  onApiLevel(34);
});

afterEach(() => {
  Object.defineProperty(Platform, 'Version', versionDescriptor);
});

it('a recognised venue QR is one medium impact, through the view haptics that respect the system setting', async () => {
  haptics.impact('medium');
  await flush();
  expect(perform).toHaveBeenCalledTimes(1);
  expect(perform).toHaveBeenCalledWith(AndroidHaptics.Confirm);
  // Never the Vibrator-based calls, which ignore "Touch feedback".
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

it('runner ticks are a light clock tick; a finished rest is a success', async () => {
  haptics.impact('light');
  haptics.notification('success');
  await flush();
  expect(perform.mock.calls.map(([cue]) => cue)).toEqual([AndroidHaptics.Clock_Tick, AndroidHaptics.Confirm]);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

describe('one constant, chosen by the API level, that the phone has', () => {
  const cues: HapticCue[] = ['light', 'medium', 'heavy', 'success', 'warning', 'error', 'selection'];

  async function played(level: number): Promise<Record<string, string>> {
    onApiLevel(level);
    perform.mockClear();
    haptics.impact('light');
    haptics.impact('medium');
    haptics.impact('heavy');
    haptics.notification('success');
    haptics.notification('warning');
    haptics.notification('error');
    haptics.selection();
    await flush();
    // Exactly one call per cue: there is no fallback chain.
    expect(perform).toHaveBeenCalledTimes(cues.length);
    return Object.fromEntries(cues.map((cue, index) => [cue, perform.mock.calls[index][0]]));
  }

  it('API 29 (Android 10): no Confirm, Reject or Segment_Tick', async () => {
    expect(await played(29)).toEqual({
      light: AndroidHaptics.Clock_Tick,
      medium: AndroidHaptics.Virtual_Key,
      heavy: AndroidHaptics.Long_Press,
      success: AndroidHaptics.Virtual_Key,
      warning: AndroidHaptics.Long_Press,
      error: AndroidHaptics.Long_Press,
      selection: AndroidHaptics.Clock_Tick,
    });
  });

  it('API 30 (Android 11): Confirm and Reject, still no Segment_Tick', async () => {
    expect(await played(30)).toEqual({
      light: AndroidHaptics.Clock_Tick,
      medium: AndroidHaptics.Confirm,
      heavy: AndroidHaptics.Long_Press,
      success: AndroidHaptics.Confirm,
      warning: AndroidHaptics.Reject,
      error: AndroidHaptics.Reject,
      selection: AndroidHaptics.Clock_Tick,
    });
  });

  it('API 34 (Android 14): Segment_Tick for a selection', async () => {
    expect((await played(34)).selection).toBe(AndroidHaptics.Segment_Tick);
  });

  it('the oldest supported phone (API 24) only gets constants every API level has', () => {
    const everywhere = new Set<string>([
      AndroidHaptics.Clock_Tick,
      AndroidHaptics.Context_Click,
      AndroidHaptics.Keyboard_Tap,
      AndroidHaptics.Long_Press,
      AndroidHaptics.Virtual_Key,
    ]);
    for (const cue of cues) expect(everywhere.has(androidCueFor(cue, 24))).toBe(true);
  });
});

it('never throws, even with no haptic engine or native module', async () => {
  perform.mockImplementation(() => {
    throw new Error('no native module');
  });
  expect(() => haptics.impact('heavy')).not.toThrow();
  expect(() => haptics.selection()).not.toThrow();
  perform.mockImplementation(() => Promise.reject(new Error('no engine')));
  expect(() => haptics.notification('error')).not.toThrow();
  await flush();
});
