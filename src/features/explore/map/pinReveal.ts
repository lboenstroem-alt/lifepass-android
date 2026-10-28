// How far the Explore map slides when a pin is pinned low on the screen, so
// the pin is not hidden under its own card: the Android port of iOS
// `VenuePinReveal` (Models/CategoryMapping.swift), the web's `popupPanOffset`.
//
// The web moves the map so its floating card fits; on a phone the card is
// fixed at the bottom of the map, so the map moves the pin instead: up, until
// the pin's name sits `REVEAL_MARGIN` above the card's top edge. Only when the
// pin fits between what covers the top of the map (the controls, the legend,
// the location banner) and the card; on a map too short for that (a small
// phone) the map stays where the member tapped, and if the pin is still under
// the card, the card drops its "Tap again" line (a tap there would land on
// the card). Only on a pin, never on a move the member makes.
//
// All values in one coordinate space with y growing down (the map's, in dp).

/** From the pin's coordinate to the top (or bottom) of the pinned marker: the 44 pt ring with its halo, grown 1.12. */
export const PIN_REACH = 30;
/** From the coordinate to the top of the venue's name, set under the photo's own (ungrown) frame. */
export const NAME_OFFSET = 22;
/** Clear space kept between the pin's name and the card. */
export const REVEAL_MARGIN = 12;

export interface RevealMove {
  /** The dp the pin moves up the screen; 0 for no move. */
  readonly shift: number;
  /** The pin's centre is under the card after the move (a map too short to clear it). */
  readonly pinStillCovered: boolean;
}

export interface RevealInput {
  /** Where the venue's coordinate (the pin's centre) lands. */
  readonly pinY: number;
  /** The height of the venue's name under the pin. */
  readonly nameHeight: number;
  /** The card's top edge. */
  readonly cardTop: number;
  /** The card's bottom edge. */
  readonly cardBottom: number;
  /** The bottom of what covers the top of the map: the pin's top stays below it. */
  readonly mapTop?: number;
}

export function revealMove({ pinY, nameHeight, cardTop, cardBottom, mapTop = 0 }: RevealInput): RevealMove {
  const below = Math.max(PIN_REACH, NAME_OFFSET + nameHeight);
  const overlap = pinY + below + REVEAL_MARGIN - cardTop;
  const fits = cardTop - mapTop >= PIN_REACH + below + REVEAL_MARGIN;
  const shift = overlap > 0 && fits ? overlap : 0;
  const centre = pinY - shift;
  return { shift, pinStillCovered: centre >= cardTop && centre <= cardBottom };
}

/** A venue name's line height under its pin (iOS `AttractionMapLayout.venueTitleLineHeight`). */
export const NAME_LINE_HEIGHT = 14;
/** Past this width a venue name wraps once (iOS `venueTitleMaxWidth`). */
export const NAME_MAX_WIDTH = 128;
/**
 * About how wide one character of the 11.5 pt semibold name sets, measured a
 * little wide on purpose (as iOS measures the name): an overestimate can only
 * move a pin a few dp further, never leave its name under the card.
 */
const NAME_CHAR_WIDTH = 6.6;

/**
 * The height of a venue's name under its pin: one line, or two once it is
 * wider than `NAME_MAX_WIDTH` (iOS `venueTitleSize`). Estimated from its
 * length, since the map draws the name itself.
 */
export function venueNameHeight(name: string): number {
  const width = Array.from(name).length * NAME_CHAR_WIDTH + 4;
  return (width > NAME_MAX_WIDTH ? 2 : 1) * NAME_LINE_HEIGHT;
}
