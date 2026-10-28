/**
 * The meal photo encoder (MEAL-3): crop to the guide, at most 1,024 px, at
 * most 600 KB, JPEG metadata stripped byte by byte, a 64 px floor.
 *
 *   const encoded = await encodeMealImage(source, { crop }, nativeMealImagePipeline);
 *   mealApi().scan({ image: { mediaType: 'image/jpeg', dataBase64: encoded.base64 }, ... }, key);
 */
export {
  encodeAttempts,
  encodeMealImage,
  jpegDataUri,
  MEAL_IMAGE_LONG_EDGE,
  MEAL_IMAGE_MAX_BYTES,
  MEAL_IMAGE_MIN_SHORT_EDGE,
  MEAL_IMAGE_RETRY_LONG_EDGE,
  MEAL_THUMBNAIL_LONG_EDGE,
  mealThumbnail,
  MealImageEncoderError,
  type EncodedMealImage,
  type LoadedMealImage,
  type MealImageCrop,
  type MealImageEncodeOptions,
  type MealImageFailure,
  type MealImagePipeline,
  type MealImageSource,
} from './encoder';
export { JpegMalformedError, stripJpegMetadata } from './jpegStrip';
export { base64FromBytes, bytesFromBase64 } from './base64';
export { normalisedGuideRect, pixelCropRect, redrawSize, type Rect, type Size } from './cropMath';
