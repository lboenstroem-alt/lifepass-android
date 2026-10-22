/**
 * "Choose a photo": the system Photo Picker (iOS `PhotosPicker`), through
 * expo-image-picker.
 *
 * NO PERMISSION. On Android 13 and later this is the system Photo Picker; on
 * older phones Google Play services provides the same picker (the library
 * declares it). Neither needs a media permission, and app.json blocks
 * READ_MEDIA_IMAGES, READ_MEDIA_VIDEO and the storage permissions so no
 * library can add them back (config/fragments/imagePicker.js).
 *
 * THE COPY. The library hands back a copy of the picked photo in the app's
 * private cache, original metadata and all. The encoder decodes it and
 * deletes it at once (`dropAfterLoad`); this module never reads it.
 */
import * as ImagePicker from 'expo-image-picker';

import { deleteFileQuietly } from '../imageEncoder/pipeline';

export type PickedPhoto =
  | { readonly kind: 'picked'; readonly uri: string }
  | { readonly kind: 'cancelled' }
  /** The picker answered with nothing usable (iOS `loadTransferable` failing): "That photo format isn't supported." */
  | { readonly kind: 'failed' };

export async function pickMealPhoto(): Promise<PickedPhoto> {
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
  return { kind: 'picked', uri: asset.uri };
}
