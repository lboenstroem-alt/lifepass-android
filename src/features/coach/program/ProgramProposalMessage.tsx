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
import { View } from 'react-native';

import type { HealthProposal } from '../../../health';
import { useT } from '../../../i18n';
import { MessageBubble } from '../../../screens/coach/MessageBubble';
import ProgramProposalCard from '../../plan/proposal/ProgramProposalCard';
import type { CoachMessageRendererProps } from '../flows/types';

import { proposalOf } from './messages';
import { replaceProposal, setProposalOutcome } from './wizard';

function ProgramProposalMessage({ message }: CoachMessageRendererProps) {
  const { t } = useT();
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
  const card = (
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
  // Changes made in chat do not survive the switch (apart from the
  // equipment the member does not have): said under the card until it is
  // decided (COACH-6, iOS).
  if (!payload.warningKey || payload.outcome !== null) return card;
  return (
    <View style={{ gap: 14 }}>
      {card}
      <MessageBubble role="assistant" text={t(payload.warningKey)} />
    </View>
  );
}

export default memo(ProgramProposalMessage);
