/**
 * The Coach's on-photo palette (iOS CoachView.swift, "On-photo palette").
 *
 * The Coach stays a full-bleed `bg-chat` photo with WHITE text, while the rest
 * of the app is light paper. 2.5.4 made it readable: a dark ink scrim over
 * the whole height and every bubble, chip and card in DARK GLASS. iOS
 * measured the worst 5% of each text band on the photo: white text at 8.2:1
 * or better, text2 6.5:1, text3 5.0:1, the placeholder 7.9:1; white text on
 * the glass stays at 7.3:1 even over a pure white pixel.
 *
 * Exported so the flows' own bubbles (plan cards, proposal cards) sit on the
 * photo in the same palette.
 */
import { colors } from '../../../theme';

/** The scrim's ink (iOS `overlayInk`, rgb 8 14 30). */
const INK = 'rgb(8,14,30)';
const ink = (alpha: number) => `rgba(8,14,30,${alpha})`;
const white = (alpha: number) => `rgba(255,255,255,${alpha})`;

export const coachPalette = {
  /** Primary text. */
  textPrimary: '#FFFFFF',
  /** Secondary text (iOS coachText2, white 0.85). */
  textSecondary: white(0.85),
  /** Tertiary / meta (iOS coachText3, white 0.70). */
  textMeta: white(0.7),
  /** Dark glass: bubbles, chips, tiles, cards (iOS coachTile, rgb 0.04 0.08 0.18 at 0.72). */
  tile: 'rgba(10,20,46,0.72)',
  /** Chip and tile hairline (iOS coachStroke). */
  stroke: white(0.22),
  /** The hairline around a bubble or card on glass (iOS coachGlassStroke). */
  glassStroke: white(0.16),
  /** The empty-state chips' capsule outline (white 0.25). */
  chipStroke: white(0.25),
  /** The input's placeholder (iOS coachPlaceholder). */
  placeholder: white(0.7),
  /** The input's solid fill (rgb 0.04 0.08 0.18). */
  inputFill: 'rgb(10,20,46)',
  /** The free tier's membership card (the same ink at 0.86) and its hairline. */
  cardFill: 'rgba(10,20,46,0.86)',
  cardStroke: white(0.18),
  /** The drawer (#0E1E38). */
  drawer: '#0E1E38',
  /** Behind the drawer. */
  drawerScrim: 'rgba(0,0,0,0.55)',
  /** The member's bubbles and a chosen chip: the darker action blue (white text 6.0:1). */
  userBubble: colors.actionFill,
  /** The send arrow, the recording mic, Book it (iOS lpRust). */
  accent: colors.rust,
  /** The category tiles' icons (iOS lpRust2). */
  tileIcon: colors.rust2,
  /** The assistant avatar's wave (iOS lpAurora), on a 15% disc. */
  avatar: colors.aurora,
  avatarDisc: 'rgba(71,133,194,0.15)',
  /** The base behind the photo (only seen if it fails to load), and the CTA's text. */
  ink: INK,
  /** The scrim, top to bottom (iOS 2.5.4 stops). */
  scrimColors: [ink(0.66), ink(0.66), ink(0.64), ink(0.66), ink(0.74)] as const,
  scrimLocations: [0, 0.3, 0.52, 0.82, 1] as const,
  /** The free tier's count line (white 0.78) and the card's body (white 0.82). */
  freeLine: white(0.78),
  freeBody: white(0.82),
} as const;

/** The input bar is drawn at 55% while an allowance is spent (iOS `.opacity(vm.isAILocked ? 0.55 : 1)`). */
export const LOCKED_INPUT_OPACITY = 0.55;
