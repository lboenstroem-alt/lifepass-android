/**
 * Where Photo mode puts its dashed guide square (iOS `PhotoCaptureMode.body`
 * geometry): clear of the header and the mode switcher above, and of the
 * hint pill, the first-use tip, the tray and the shutter row below. On a
 * short phone the square gives way (down to 160) rather than overlap
 * either; it is never wider than 320 or the screen less 64.
 */
import type { Rect } from '../imageEncoder/cropMath';

export interface GuideLayoutInput {
  readonly width: number;
  readonly height: number;
  /** The page header (status bar, close row and switcher): `CameraModeProps.headerHeight`. */
  readonly headerHeight: number;
  readonly bottomInset: number;
  readonly trayEmpty: boolean;
  readonly showsTip: boolean;
}

/** The shutter row, and what the tray bar and the tip add under the square. */
export const SHUTTER_BLOCK = 120;
export const TRAY_BLOCK = 76;
export const TIP_BLOCK = 84;
/** The hint pill's room under the square. */
export const HINT_ROOM = 56;

export function photoGuideRect(input: GuideLayoutInput): Rect {
  const bottomBlock = SHUTTER_BLOCK + (input.trayEmpty ? 0 : TRAY_BLOCK) + (input.showsTip ? TIP_BLOCK : 0);
  const regionTop = input.headerHeight + 16;
  const regionBottom = input.height - input.bottomInset - bottomBlock - HINT_ROOM;
  const side = Math.max(160, Math.min(input.width - 64, 320, regionBottom - regionTop));
  const centreY = Math.max(regionTop + side / 2, (regionTop + regionBottom) / 2);
  return { x: (input.width - side) / 2, y: centreY - side / 2, width: side, height: side };
}
