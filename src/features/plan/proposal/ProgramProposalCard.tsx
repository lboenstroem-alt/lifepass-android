// @f4-stub (plan 3.0.3): a proposed programme's card, filled by PLAN-4; mounted by COACH-4, COACH-5 and Plan.
//
// iOS `ProgramProposalCard(program:week1:palette:...)`: the plan, its first
// week, adopt / switch / discard, change days, reminders. The card reads the
// proposal itself (the current one, or `programId`); the host says how it
// looks and where "Open Plan" goes.
// Keep the default export and its props; replace the body (and this marker).
// A filler may add OPTIONAL props. Renders nothing until PLAN-4 lands.

/** The Coach's dark chat, or Plan's paper. */
export type ProposalPalette = 'coach' | 'plan';

export interface ProgramProposalCardProps {
  readonly palette: ProposalPalette;
  /** A specific proposal; the member's current one when omitted. */
  readonly programId?: string;
  /** Open Plan from a collapsed card. */
  readonly onOpenPlan?: () => void;
}

export default function ProgramProposalCard(_props: ProgramProposalCardProps) {
  return null;
}
