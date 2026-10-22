/**
 * The app's own native helpers for the meal photo (the local Expo module in
 * modules/lifepass-meal-image, owner MEAL-3), so that no meal photo is ever
 * written to disk (plan MEAL-3; iOS `MealImageEncoder`: "Nothing here writes
 * a file"):
 *
 * - `encodeJpegAsync`: a decoded bitmap as JPEG, compressed into memory
 *   (expo-image-manipulator's `saveAsync` always writes the JPEG to the cache
 *   folder first);
 * - `pickImageAsync`: the system Photo Picker, answering with the picked
 *   photo's own `content://` URI (expo-image-picker always copies the
 *   original, metadata and all, into the cache folder first).
 *
 * Every build made from this code has the module (autolinked from ./modules
 * at prebuild). A binary built before it (an old dev client) does not; there
 * the pipeline falls back to the libraries' file path, deleting each file the
 * moment it is read and sweeping the folders (./pipeline.ts).
 */
import { requireOptionalNativeModule } from 'expo';

export interface MealImageNative {
  /** A decoded bitmap (a manipulator image or a camera picture ref) as a JPEG in base64, encoded in memory. */
  encodeJpegAsync(image: object, quality: number): Promise<string>;
  /** The system Photo Picker: the picked photo's `content://` URI, or null when the member backed out. Throws when it answers without one. */
  pickImageAsync(): Promise<string | null>;
}

let loaded: MealImageNative | null | undefined;
let replaced: MealImageNative | null | undefined;

/** The module, or null in a binary built without it. */
export function mealImageNative(): MealImageNative | null {
  if (replaced !== undefined) return replaced;
  if (loaded === undefined) {
    try {
      loaded = requireOptionalNativeModule<MealImageNative>('LifePassMealImage');
    } catch {
      loaded = null;
    }
  }
  return loaded ?? null;
}

/** Tests: a fake module (null: a binary without it; undefined: back to the real lookup). */
export function setMealImageNativeForTests(next: MealImageNative | null | undefined): void {
  replaced = next;
}
