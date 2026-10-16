import * as Haptics from 'expo-haptics';

import { ANDROID_CUES, haptics } from '../haptics';

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

beforeEach(() => {
  perform.mockImplementation(() => Promise.resolve());
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

it('falls back to a constant every API level has when the preferred one is missing', async () => {
  perform.mockImplementation((cue: string) =>
    cue === AndroidHaptics.Confirm ? Promise.reject(new Error('not supported')) : Promise.resolve(),
  );
  haptics.notification('success');
  await flush();
  expect(perform.mock.calls.map(([cue]) => cue)).toEqual([AndroidHaptics.Confirm, AndroidHaptics.Virtual_Key]);
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

it('every cue ends in a constant that exists on every Android version', () => {
  const everywhere = new Set<string>([
    AndroidHaptics.Clock_Tick,
    AndroidHaptics.Context_Click,
    AndroidHaptics.Keyboard_Tap,
    AndroidHaptics.Long_Press,
    AndroidHaptics.Virtual_Key,
  ]);
  const chains = [
    ...Object.values(ANDROID_CUES.impact),
    ...Object.values(ANDROID_CUES.notification),
    ANDROID_CUES.selection,
  ];
  for (const chain of chains) expect(everywhere.has(chain[chain.length - 1])).toBe(true);
});
