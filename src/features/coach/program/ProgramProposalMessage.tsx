/**
 * A built plan in the chat: PLAN-4's `ProgramProposalCard` in the Coach's
 * palette, over the programme the build answered with (iOS `CoachView`'s
 * `message.programProposal` branch).
 *
 * The outcome lives on the message (`setProposalOutcome`), so the card stays
 * collapsed through every redraw and a member who comes back to the Coach
 * sees what they did; a change of days redraws it from the server's answer
 * (`replaceProposal`). Week one is the plan's week numbered 1, as iOS reads
 * it.
 */
import { memo, useMemo } from 'react';

import type { HealthProposal } from '../../../health';
import ProgramProposalCard from '../../plan/proposal/ProgramProposalCard';
import type { CoachMessageRendererProps } from '../flows/types';

import { proposalOf } from './messages';
import { replaceProposal, setProposalOutcome } from './wizard';

function ProgramProposalMessage({ message }: CoachMessageRendererProps) {
  const payload = proposalOf(message);
  const detail = payload?.detail ?? null;
  const proposal = useMemo<HealthProposal | null>(
    () =>
      detail
        ? {
            program: detail.program,
            week1: [...((detail.weekPlans ?? []).find((week) => week.weekNo === 1)?.days ?? [])],
          }
        : null,
    [detail],
  );
  if (!payload || !proposal) return null;
  return (
    <ProgramProposalCard
      palette="coach"
      programId={proposal.program.id}
      proposal={proposal}
      outcome={payload.outcome}
      onOutcome={(outcome) => setProposalOutcome(message.id, outcome)}
      onProgramUpdated={(updated) => replaceProposal(message.id, updated)}
      testID={`coach.program.proposal.${message.id}`}
    />
  );
}

export default memo(ProgramProposalMessage);
