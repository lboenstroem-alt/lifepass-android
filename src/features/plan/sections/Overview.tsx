/* eslint lifepass/no-literal-copy: "error" */
/**
 * Plan's "This plan" section (PLAN-4, mounted by PLAN-1 under the feedback
 * card of a live, paused or finished programme): iOS PlanView's
 * `PlanOverviewCard` and the sheets it opens.
 *
 *   See all weeks      the programme overview, live mode
 *   Change             the change-days sheet (`program` mode); a save or a
 *                      "changed elsewhere" reads Plan again, the latter with
 *                      its toast
 *   Add weight and...  the body sheet in update mode for this programme
 *   Pause / End        a confirmation with a body (iOS ConfirmSheet): a
 *                      pause stops sessions and the workout day notes, and
 *                      "End plan" alone would not say that the history stays
 *   Resume             at once, no confirmation
 *
 * A finished block cannot be paused, resumed or ended: its rows offer what
 * they always did, greyed, rather than posting a change the server refuses.
 * Draws nothing for a day without a programme.
 */
import { useState } from 'react';

import { ConfirmSheet } from '../../../components/ui';
import { useHealthStore } from '../../../health';
import { useT } from '../../../i18n';
import { openBodySheet } from '../../body/sheets';
import { openChangeDays } from '../days';
import PlanOverviewCard from '../overview/PlanOverviewCard';
import { pushPlanRoute, reloadPlan, setProgramStatus, usePlanView } from '../shell';

type Confirming = { readonly kind: 'pause' | 'end'; readonly programId: string };

export default function OverviewSection() {
  const { t } = useT();
  const view = usePlanView();
  const program = view.shownDay?.program ?? null;
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  // Kept while the sheet slides away, so its words do not vanish mid-slide.
  const [lastConfirming, setLastConfirming] = useState<Confirming | null>(null);

  if (!program) return null;

  const ask = (kind: Confirming['kind']) => {
    const next = { kind, programId: program.id };
    setLastConfirming(next);
    setConfirming(next);
  };
  const shown = confirming ?? lastConfirming;
  const reload = () => void reloadPlan({ force: true });

  return (
    <>
      <PlanOverviewCard
        program={program}
        isOffline={view.isOffline}
        isReadOnly={view.isReadOnly || view.isBlockFinished}
        onSeeAll={() => pushPlanRoute('ProgramOverview', { programId: program.id, mode: 'live' })}
        onChangeDays={() =>
          openChangeDays({
            kind: 'program',
            programId: program.id,
            daysPerWeek: program.daysPerWeek ?? 3,
            selected: program.trainingDays ?? [],
            onSaved: reload,
            onChanged: () => {
              useHealthStore.getState().setToast('health.err.changed');
              reload();
            },
          })
        }
        onSetTargets={() => openBodySheet({ kind: 'update', programId: program.id, onSaved: reload })}
        onPause={() => ask('pause')}
        onResume={() => void setProgramStatus('active', program.id)}
        onEnd={() => ask('end')}
      />
      {shown ? (
        <ConfirmSheet
          visible={confirming !== null}
          title={t(shown.kind === 'pause' ? 'plan.pause.title' : 'plan.end.title')}
          body={t(shown.kind === 'pause' ? 'plan.pause.body' : 'plan.end.body')}
          confirmLabel={t(shown.kind === 'pause' ? 'plan.pause.confirm' : 'plan.end.confirm')}
          destructive={shown.kind === 'end'}
          onConfirm={() => void setProgramStatus(shown.kind === 'pause' ? 'paused' : 'abandoned', shown.programId)}
          onClose={() => setConfirming(null)}
          testID={`plan.overview.${shown.kind}Confirm`}
        />
      ) : null}
    </>
  );
}
