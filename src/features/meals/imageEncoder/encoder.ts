/**
 * Turns a meal photo into the small, metadata-free JPEG the scan route takes:
 * the Android port of iOS `MealImageEncoder` (Services/MealImageEncoder.swift,
 * ios-ux.md 12.4 step 3, api-contract.md 4.5).
 *
 * WHAT LEAVES THE PHONE IS PIXELS, AND ONLY PIXELS. A camera frame carries
 * the phone's make and model, the time, and often the place it was taken; a
 * library photo can carry all of that and a name. None of it is needed to
 * guess what is on a plate, so:
 *
 * 1. a camera capture is cropped to the guide square the member aimed with
 *    (a library photo is kept whole: the member chose it);
 * 2. it is redrawn at most 1,024 px on its long edge into a new bitmap,
 *    which carries none of the original's metadata (the orientation is
 *    applied to the pixels on the way in);
 * 3. it is re-encoded as a JPEG under 600 KB: quality 0.7, then 0.55, then
 *    a 768 px long edge at 0.6;
 * 4. and then walked byte by byte with the SAME keep list as the server's
 *    `stripJpegMetadata` (./jpegStrip.ts).
 *
 * A short edge under the server's 64 px floor is refused here as "too small"
 * before any request is spent (the server would answer the same 413 as an
 * oversized photo, and a retry at 768 px cannot add pixels back).
 *
 * The native half (decoding, cropping, scaling, JPEG encoding) is behind
 * `MealImagePipeline` (./pipeline.ts on the phone, a fake in the tests); the
 * rules are here, so they are tested exactly as iOS's are.
 */
import { base64FromBytes, bytesFromBase64 } from './base64';
import { normalisedGuideRect, pixelCropRect, redrawSize, type Rect, type Size } from './cropMath';
import { JpegMalformedError, stripJpegMetadata } from './jpegStrip';

/** iOS `MealImageEncoder.Failure`. */
export type MealImageFailure =
  /** Not an image the phone can read. */
  | 'unreadable'
  /** Even the smallest encoding is over the limit. */
  | 'tooLarge'
  /** Under the server's short-edge floor: too few pixels to read food in. */
  | 'tooSmall'
  /** The byte walk met something it cannot account for. */
  | 'malformed';

export class MealImageEncoderError extends Error {
  readonly failure: MealImageFailure;

  constructor(failure: MealImageFailure, cause?: unknown) {
    super(failure);
    this.name = 'MealImageEncoderError';
    this.failure = failure;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** The server refuses a decoded image over 600 KB (`MEAL_SCAN_MAX_DECODED_BYTES`). */
export const MEAL_IMAGE_MAX_BYTES = 600 * 1024;
export const MEAL_IMAGE_LONG_EDGE = 1024;
/** The second attempt after a 413 (0.7 `meal_image_too_large`). */
export const MEAL_IMAGE_RETRY_LONG_EDGE = 768;
/**
 * The server's `MEAL_SCAN_MIN_SHORT_EDGE_PX` (api-contract.md 4.5), to the
 * pixel and inclusive: 64 px goes, 63 px does not.
 */
export const MEAL_IMAGE_MIN_SHORT_EDGE = 64;

/** The stripped JPEG, ready for OP-32. Lives in memory only. */
export interface EncodedMealImage {
  /** The JPEG as base64 (what OP-32's `dataBase64` takes). */
  readonly base64: string;
  readonly byteLength: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** Where the pixels come from. */
export type MealImageSource =
  /** A native image held in memory (a camera still taken as a picture ref). */
  | { readonly kind: 'ref'; readonly ref: object }
  /** A file or a `data:` URI. `dropAfterLoad`: the file is a copy to delete once decoded (a picked photo). */
  | { readonly kind: 'uri'; readonly uri: string; readonly dropAfterLoad?: boolean };

/** A decoded, upright image the pipeline holds. */
export interface LoadedMealImage {
  readonly width: number;
  readonly height: number;
}

/** The native half: decode, crop, scale and JPEG-encode, all in memory as far as the platform allows. */
export interface MealImagePipeline {
  /** Decode `source` with its orientation applied. Throws when it is not an image. */
  load(source: MealImageSource): Promise<LoadedMealImage>;
  /** Crop (pixels of the loaded image), scale to exactly `size`, encode as JPEG at `quality`: base64. */
  render(image: LoadedMealImage, crop: Rect | null, size: Size, quality: number): Promise<string>;
  /** Let go of the decoded image. */
  release(image: LoadedMealImage): void;
}

/** How much of the image to keep. */
export type MealImageCrop =
  /** The whole image (a library photo, a retry of what was already sent). */
  | { readonly kind: 'none' }
  /** A normalised rect (0 to 1) of the oriented image. */
  | { readonly kind: 'normalised'; readonly rect: Rect }
  /** The guide square the member aimed with, in a preview of `view` drawn with aspect fill. */
  | { readonly kind: 'guide'; readonly guide: Rect; readonly view: Size };

export interface MealImageEncodeOptions {
  readonly crop?: MealImageCrop;
  /** 1,024, or 768 for the retry after a 413. */
  readonly maxLongEdge?: number;
}

/** The attempts, in order: quality 0.7; over 600 KB, 0.55; still over, a 768 px long edge at 0.6. */
export function encodeAttempts(maxLongEdge: number): readonly (readonly [edge: number, quality: number])[] {
  return [
    [maxLongEdge, 0.7],
    [maxLongEdge, 0.55],
    [Math.min(maxLongEdge, MEAL_IMAGE_RETRY_LONG_EDGE), 0.6],
  ];
}

function cropRectFor(crop: MealImageCrop, size: Size): Rect | null {
  switch (crop.kind) {
    case 'none':
      return null;
    case 'normalised':
      return pixelCropRect(crop.rect, size);
    case 'guide':
      return pixelCropRect(normalisedGuideRect(crop.guide, crop.view, size), size);
  }
}

/**
 * Encode a meal photo for OP-32. Throws `MealImageEncoderError`. Nothing is
 * kept but the returned base64: the decoded image is released before this
 * returns, whatever happens.
 */
export async function encodeMealImage(
  source: MealImageSource,
  options: MealImageEncodeOptions,
  pipeline: MealImagePipeline,
): Promise<EncodedMealImage> {
  const maxLongEdge = options.maxLongEdge ?? MEAL_IMAGE_LONG_EDGE;
  let image: LoadedMealImage;
  try {
    image = await pipeline.load(source);
  } catch (error) {
    throw new MealImageEncoderError('unreadable', error);
  }
  try {
    if (!(image.width > 0) || !(image.height > 0)) throw new MealImageEncoderError('unreadable');
    const crop = cropRectFor(options.crop ?? { kind: 'none' }, image);
    const base: Size = crop ? { width: crop.width, height: crop.height } : { width: image.width, height: image.height };
    const attempts = encodeAttempts(maxLongEdge);
    for (let index = 0; index < attempts.length; index += 1) {
      const [edge, quality] = attempts[index]!;
      const size = redrawSize(base, edge);
      // The first attempt is the largest this photo will ever be drawn. Under
      // the floor there, it is under it at every quality, and the server
      // would refuse it: say so now, before a request is spent.
      if (index === 0 && Math.min(size.width, size.height) < MEAL_IMAGE_MIN_SHORT_EDGE) {
        throw new MealImageEncoderError('tooSmall');
      }
      let encoded: string;
      try {
        encoded = await pipeline.render(image, crop, size, quality);
      } catch (error) {
        throw new MealImageEncoderError('unreadable', error);
      }
      const stripped = strip(encoded);
      const last = index === attempts.length - 1;
      if (stripped.length <= MEAL_IMAGE_MAX_BYTES || last) {
        if (stripped.length > MEAL_IMAGE_MAX_BYTES) throw new MealImageEncoderError('tooLarge');
        return {
          base64: base64FromBytes(stripped),
          byteLength: stripped.length,
          pixelWidth: size.width,
          pixelHeight: size.height,
        };
      }
    }
    throw new MealImageEncoderError('tooLarge');
  } finally {
    pipeline.release(image);
  }
}

/** The pipeline's JPEG through the byte walk. */
function strip(base64: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bytesFromBase64(base64);
  } catch (error) {
    throw new MealImageEncoderError('unreadable', error);
  }
  try {
    return stripJpegMetadata(bytes);
  } catch (error) {
    if (error instanceof JpegMalformedError) throw new MealImageEncoderError('malformed', error);
    throw error;
  }
}

/** A `data:` URI for an encoded photo (the retry re-reads it; the draft banner shows it). */
export function jpegDataUri(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

/** The long edge of the draft editor's picture (iOS `MealImageEncoder.thumbnail(maxPixel: 512)`). */
export const MEAL_THUMBNAIL_LONG_EDGE = 512;
/** The thumbnail never leaves the phone; this only keeps it small in memory. */
const THUMBNAIL_QUALITY = 0.8;

/**
 * A small preview of what was sent, for the draft editor's banner: at most
 * 512 px on its long edge, as a `data:` URI, in memory only (iOS keeps a
 * UIImage of the same size). Null when the phone cannot redraw it; the
 * caller then keeps the sent JPEG itself, which is already in memory.
 */
export async function mealThumbnail(base64: string, pipeline: MealImagePipeline, maxLongEdge: number = MEAL_THUMBNAIL_LONG_EDGE): Promise<string | null> {
  let image: LoadedMealImage;
  try {
    image = await pipeline.load({ kind: 'uri', uri: jpegDataUri(base64) });
  } catch {
    return null;
  }
  try {
    if (!(image.width > 0) || !(image.height > 0)) return null;
    const size = redrawSize(image, maxLongEdge);
    const rendered = await pipeline.render(image, null, size, THUMBNAIL_QUALITY);
    return rendered.length > 0 ? jpegDataUri(rendered) : null;
  } catch {
    return null;
  } finally {
    pipeline.release(image);
  }
}
