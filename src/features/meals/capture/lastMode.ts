/**
 * The mode the member used last (iOS `MealCaptureMode.lastUsed`, R2): the
 * meal page opens in it from the Scan tab. Photo the first time, and Search
 * whenever the camera is not allowed.
 *
 * A mode, not health data: it lives in AsyncStorage under iOS's key, for
 * every member on the phone, and no wipe removes it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MealCaptureMode } from '../../../navigation/types';

import { CAPTURE_MODES } from './captureModel';

export const LAST_MODE_KEY = 'meal.capture.lastMode';

function isMode(value: string | null): value is MealCaptureMode {
  return (CAPTURE_MODES as readonly string[]).includes(value ?? '');
}

/** The mode stored, or null when there is none (or it cannot be read). */
export async function storedLastMode(): Promise<MealCaptureMode | null> {
  try {
    const stored = await AsyncStorage.getItem(LAST_MODE_KEY);
    return isMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The mode to open in, from what is known now. */
export function openingModeFrom(cameraAllowed: boolean, stored: MealCaptureMode | null): MealCaptureMode {
  if (!cameraAllowed) return 'search';
  return stored ?? 'photo';
}

/** The mode to open in. */
export async function lastUsedMode(cameraAllowed: boolean): Promise<MealCaptureMode> {
  if (!cameraAllowed) return 'search';
  return openingModeFrom(true, await storedLastMode());
}

/** Remember a mode the member switched to. */
export function rememberMode(mode: MealCaptureMode): void {
  AsyncStorage.setItem(LAST_MODE_KEY, mode).catch(() => undefined);
}
