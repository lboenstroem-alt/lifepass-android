/**
 * The phone's half of the meal photo encoder: decode, crop, scale and JPEG
 * encode, off the JS thread.
 *
 * NO MEAL PHOTO IS WRITTEN TO DISK (plan MEAL-3; iOS `MealImageEncoder`:
 * "Nothing here writes a file"). Every step runs in memory:
 * - a camera still arrives as a picture ref (a bitmap in memory; expo-camera
 *   writes no file for it) and is decoded with its orientation applied;
 * - a picked photo is decoded straight from the Photo Picker's `content://`
 *   URI (./nativeImage.ts; Glide, no disk cache);
 * - expo-image-manipulator crops and scales bitmaps in memory;
 * - the JPEG is compressed into memory by the app's own module
 *   (./nativeImage.ts), not by the manipulator's `saveAsync`, which always
 *   writes a file first.
 *
 * FALLBACK, for a binary built without that module (an old dev client): the
 * libraries' own file path. The picked copy expo-image-picker writes into
 * `cache/ImagePicker/` is deleted the moment it is decoded, and the JPEG
 * `saveAsync` writes into `cache/ImageManipulator/` the moment it is read
 * back; `sweepMealPhotoFiles` removes both folders the next time Photo opens,
 * at a health wipe and at sign-out, in case the app died in between. Nothing
 * else in the app uses either library (MEAL-3 owns them).
 *
 * The bytes that leave the phone are the same either way: the byte walk runs
 * on what is sent.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import type { LoadedMealImage, MealImagePipeline, MealImageSource } from './encoder';
import type { Rect, Size } from './cropMath';
import { mealImageNative } from './nativeImage';

/** The cache folders expo-image-picker and expo-image-manipulator write into (the fallback path only). */
export const MEAL_PHOTO_CACHE_FOLDERS: readonly string[] = ['ImagePicker', 'ImageManipulator'];

interface NativeLoaded extends LoadedMealImage {
  readonly ref: ImageRef;
}

/**
 * Delete one of the app's own cache files by URI; a file already gone is
 * fine. Only `file:` URIs: a picked `content://` URI is the member's own
 * photo in their library, and is never touched.
 */
export function deleteFileQuietly(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('file:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to do: the sweep removes it next time.
  }
}

/**
 * Remove every leftover meal photo file (a picked copy, an encoder output)
 * from the app's cache. Safe to call at any time: nothing is ever read back
 * from these folders after the moment it was written.
 */
export function sweepMealPhotoFiles(): void {
  for (const name of MEAL_PHOTO_CACHE_FOLDERS) {
    try {
      const folder = new Directory(Paths.cache, name);
      if (folder.exists) folder.delete();
    } catch {
      // A folder that cannot be listed or removed now is tried again next time.
    }
  }
}

function released(ref: { release(): void } | null | undefined): void {
  try {
    ref?.release();
  } catch {
    // Already released.
  }
}

/** The pipeline the app uses. */
export const nativeMealImagePipeline: MealImagePipeline = {
  async load(source: MealImageSource): Promise<LoadedMealImage> {
    const context = ImageManipulator.manipulate(source.kind === 'ref' ? (source.ref as never) : source.uri);
    try {
      const ref = await context.renderAsync();
      const loaded: NativeLoaded = { ref, width: ref.width, height: ref.height };
      return loaded;
    } finally {
      released(context);
      // A picked copy (the fallback path) carried the original metadata: gone now that the pixels are in memory.
      if (source.kind === 'uri' && source.dropAfterLoad) deleteFileQuietly(source.uri);
    }
  },

  async render(image: LoadedMealImage, crop: Rect | null, size: Size, quality: number): Promise<string> {
    const { ref } = image as NativeLoaded;
    const context = ImageManipulator.manipulate(ref);
    let rendered: ImageRef | null = null;
    let fileUri: string | null = null;
    try {
      if (crop) context.crop({ originX: crop.x, originY: crop.y, width: crop.width, height: crop.height });
      context.resize({ width: size.width, height: size.height });
      rendered = await context.renderAsync();
      const native = mealImageNative();
      // In memory: no file.
      if (native) return await native.encodeJpegAsync(rendered, quality);
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      fileUri = result.uri;
      if (!result.base64) throw new Error('no base64');
      return result.base64;
    } finally {
      deleteFileQuietly(fileUri);
      released(rendered);
      released(context);
    }
  },

  release(image: LoadedMealImage): void {
    released((image as NativeLoaded).ref);
  },
};
