/**
 * "A new plan is ready for you to review." over a LIVE plan (iOS
 * `proposalWaitingRow`): the Coach built the next block while this one is
 * still running. Review opens the proposal in the programme overview, where
 * the member can start or discard it; the live plan stays as it is until
 * they do.
 */
import { StatusBanner } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { pushPlanRoute } from '../shell/planShell';

export default function ProposalWaitingRow({ programId }: { programId: string }) {
  const { t } = useT();
  return (
    <StatusBanner
      icon="sparkles-outline"
      message={t('plan.proposal_waiting')}
      actionLabel={t('plan.review')}
      onAction={() => {
        track('plan_proposal_review_opened');
        pushPlanRoute('ProgramOverview', { programId, mode: 'proposal' });
      }}
      testID="plan.banner.proposalWaiting"
    />
  );
}
