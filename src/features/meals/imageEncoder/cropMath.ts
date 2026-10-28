/**
 * Where the guide square the member aimed with lands in the photo: the port
 * of iOS `CameraCropMath` (Services/ScanCameraController.swift) and the crop
 * step of `MealImageEncoder.cropped`.
 *
 * The camera preview is drawn with aspect fill (expo-camera's default
 * `FILL_CENTER` when no `ratio` is set, with the preview and the still on the
 * same 4:3 stream), so the guide's rect in the view maps to a rect of the
 * ORIENTED still computed from the two sizes alone. Computed rather than read
 * off the preview, so it does not depend on the sensor's native orientation
 * and is testable.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const UNIT: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** The intersection of two rects, or null when they do not overlap. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right < x || bottom < y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The normalised rect (0 to 1) of an ORIENTED image that `guide` shows, in a
 * preview of `view` drawn with aspect fill. Degenerate sizes give the whole
 * image.
 */
export function normalisedGuideRect(guide: Rect, view: Size, image: Size): Rect {
  if (view.width <= 0 || view.height <= 0 || image.width <= 0 || image.height <= 0) return UNIT;
  // Aspect fill: the image is scaled up until it covers the view, and the
  // overflow is cropped equally on both sides.
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const shownWidth = image.width * scale;
  const shownHeight = image.height * scale;
  const offsetX = (shownWidth - view.width) / 2;
  const offsetY = (shownHeight - view.height) / 2;
  const rect: Rect = {
    x: (guide.x + offsetX) / shownWidth,
    y: (guide.y + offsetY) / shownHeight,
    width: guide.width / shownWidth,
    height: guide.height / shownHeight,
  };
  return intersect(rect, UNIT) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * The pixel rect a normalised crop asks for in an image of `size` (CGRect
 * `.integral`: outward to whole pixels), or null when the crop is too thin to
 * mean anything (under 5 % either way) and the whole image is kept instead.
 */
export function pixelCropRect(normalised: Rect, size: Size): Rect | null {
  const clamped = intersect(normalised, UNIT);
  if (!clamped || clamped.width <= 0.05 || clamped.height <= 0.05) return null;
  const left = clamped.x * size.width;
  const top = clamped.y * size.height;
  const right = left + clamped.width * size.width;
  const bottom = top + clamped.height * size.height;
  // `integral`: the smallest whole-pixel rect containing it, kept inside the image.
  const x = Math.max(0, Math.floor(left + 1e-9));
  const y = Math.max(0, Math.floor(top + 1e-9));
  const width = Math.min(size.width, Math.ceil(right - 1e-9)) - x;
  const height = Math.min(size.height, Math.ceil(bottom - 1e-9)) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The size an image of `size` is redrawn at for a long edge of at most
 * `maxLongEdge`: never upscaled, rounded to whole pixels, at least 1 by 1
 * (iOS `MealImageEncoder.redraw`).
 */
export function redrawSize(size: Size, maxLongEdge: number): Size {
  const scale = Math.min(1, maxLongEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
