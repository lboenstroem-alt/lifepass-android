/**
 * The proposal card's two palettes (iOS ProgramProposalCard `textColor`,
 * `tileColor`, ...): white on the Coach's dark glass, and Plan's paper.
 *
 * The Coach values are iOS's `coachText`, `coachText2`, `coachText3`,
 * `coachTile` and `coachStroke` (the Coach's own palette,
 * src/features/coach/theme/palette.ts, measured at 7.3:1 or better for white
 * text on the glass). They are restated here rather than imported because a
 * feature reaches another only through its index (plan 3.0); the two must
 * stay equal.
 */
import { colors } from '../../../theme';

import type { ProposalPalette } from './ProgramProposalCard';

export interface ProposalColours {
  readonly text: string;
  readonly text2: string;
  readonly text3: string;
  readonly tile: string;
  readonly stroke: string;
  /** Behind the week-one rows. */
  readonly rows: string;
  /** The inline error line: quiet on the glass, red on paper. */
  readonly error: string;
  /** The Coach's chat bubbles are indented past the avatar; Plan's card is not. */
  readonly leadingInset: number;
}

const white = (alpha: number) => `rgba(255,255,255,${alpha})`;

export const PROPOSAL_COLOURS: Readonly<Record<ProposalPalette, ProposalColours>> = {
  coach: {
    text: colors.onAccent,
    text2: white(0.85),
    text3: white(0.7),
    tile: 'rgba(10,20,46,0.72)',
    stroke: white(0.22),
    rows: white(0.07),
    error: white(0.85),
    leadingInset: 34,
  },
  plan: {
    text: colors.paper,
    text2: colors.paper2,
    text3: colors.paper3,
    tile: colors.ink2,
    stroke: colors.line,
    rows: colors.ink3,
    error: colors.destructive,
    leadingInset: 0,
  },
};
