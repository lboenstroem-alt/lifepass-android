/**
 * "Choose a photo": the system Photo Picker (iOS `PhotosPicker`).
 *
 * NO PERMISSION. On Android 13 and later this is the system Photo Picker; on
 * older phones Google Play services provides the same picker (expo-image-picker's
 * manifest declares the backport, and it stays installed). Neither needs a
 * media permission, and app.json blocks READ_MEDIA_IMAGES, READ_MEDIA_VIDEO
 * and the storage permissions so no library can add them back
 * (config/fragments/imagePicker.js).
 *
 * NO COPY. The app's own module (../imageEncoder/nativeImage.ts) answers with
 * the picked photo's `content://` URI, which the encoder decodes straight
 * into memory (iOS `loadTransferable` keeps the bytes in memory too). Only a
 * binary built without that module falls back to expo-image-picker, which
 * hands back a COPY in the app's private cache, original metadata and all:
 * that copy is deleted the moment it is decoded (`dropAfterLoad`), or by
 * `discardPickedPhoto` when the photo is not used.
 */
import * as ImagePicker from 'expo-image-picker';

import { mealImageNative } from '../imageEncoder/nativeImage';
import { deleteFileQuietly } from '../imageEncoder/pipeline';

export type PickedPhoto =
  | {
      readonly kind: 'picked';
      readonly uri: string;
      /** True when `uri` is a copy in the app's cache (the fallback) that must be deleted once read; false for the photo's own URI. */
      readonly copy: boolean;
    }
  | { readonly kind: 'cancelled' }
  /** The picker answered with nothing usable (iOS `loadTransferable` failing): "That photo format isn't supported." */
  | { readonly kind: 'failed' };

export async function pickMealPhoto(): Promise<PickedPhoto> {
  const native = mealImageNative();
  if (native) {
    try {
      const uri = await native.pickImageAsync();
      return uri ? { kind: 'picked', uri, copy: false } : { kind: 'cancelled' };
    } catch {
      return { kind: 'failed' };
    }
  }
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      base64: false,
      quality: 1,
    });
  } catch {
    return { kind: 'failed' };
  }
  if (result.canceled) return { kind: 'cancelled' };
  const [asset, ...rest] = result.assets ?? [];
  // Only one is asked for; anything more is dropped on the spot.
  for (const extra of rest) deleteFileQuietly(extra.uri);
  if (!asset?.uri) return { kind: 'failed' };
  return { kind: 'picked', uri: asset.uri, copy: true };
}

/** A pick that will not be used (the mode went away while the picker was open): its copy, if it made one, goes now. */
export function discardPickedPhoto(picked: PickedPhoto): void {
  if (picked.kind === 'picked' && picked.copy) deleteFileQuietly(picked.uri);
}
