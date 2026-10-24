/**
 * A feedback line's action, decided and performed (iOS PlanView
 * `resolveFeedbackAction` and `performFeedbackAction`, `SPEC` 9.6).
 *
 * Each lands where the member would go to do it by hand, and NONE CARRIES
 * ANYTHING FROM THE REPORT WITH IT: Adjust my plan opens in the Coach with
 * the fixed chip ("Adjust my plan") as the member's bubble (the `adjust`
 * entry has no payload), Change days opens the sheet on the live plan, Log a
 * meal opens the meal page on today. No report or note text ever reaches the
 * Coach, a request or analytics.
 */
import { useCallback } from 'react';

import type { FeedbackAction } from '../../api/feedback';
import { isLiveStatus } from '../../health/models';
import { selectHasLiveProgram, useHealthStore } from '../../health/store';
import { todayServerDay } from '../../i18n/format';
import { track } from '../../lib/analytics';
import { selectSupportsPlanRevision, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { openChangeDays } from '../plan/days';
import { openPlanMealCapture, popPlanToRoot, reloadPlan } from '../plan/shell';

import { resolveFeedbackAction } from './cardState';

export type ShownFeedbackAction = Exclude<FeedbackAction, 'unknown'>;

/**
 * iOS waits for the stack to finish popping before it raises a sheet or a
 * cover (one raised mid-pop is dropped), 0.45 s after a pushed screen.
 */
export const AFTER_POP_DELAY_MS = 450;

/** Which of a line's actions this member may take right now. */
export function resolveFeedbackActionNow(action: FeedbackAction | null | undefined): ShownFeedbackAction | null {
  const app = useAppStore.getState();
  const health = useHealthStore.getState();
  return resolveFeedbackAction(action, {
    supportsPlanRevision: selectSupportsPlanRevision(app),
    hasLiveProgram: selectHasLiveProgram(health),
    access: app.healthAccess,
    isCustomPlan: health.today?.program?.custom === true,
  });
}

/**
 * `resolveFeedbackActionNow` for a screen: a new resolver whenever the
 * membership, the server's features or the live plan change, so the lines
 * redraw with them.
 */
export function useFeedbackActionResolver(): (action: FeedbackAction | null) => ShownFeedbackAction | null {
  const access = useAppStore((s) => s.healthAccess);
  const supportsPlanRevision = useAppStore(selectSupportsPlanRevision);
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const isCustomPlan = useHealthStore((s) => s.today?.program?.custom === true);
  return useCallback(
    (action: FeedbackAction | null) => resolveFeedbackAction(action, { supportsPlanRevision, hasLiveProgram, access, isCustomPlan }),
    [access, supportsPlanRevision, hasLiveProgram, isCustomPlan],
  );
}

/** The tap itself: `feedback_action_tapped` with the fixed word, then the action. */
export function tapFeedbackAction(action: ShownFeedbackAction, options: { readonly fromPushedScreen: boolean }): void {
  track('feedback_action_tapped', { action });
  performFeedbackAction(action, options);
}

/**
 * Plan's stack goes back to its first screen, then the action runs. A sheet
 * or the meal page waits for the pop when there was one.
 */
export function performFeedbackAction(action: ShownFeedbackAction, options: { readonly fromPushedScreen: boolean }): void {
  popPlanToRoot();
  const delay = options.fromPushedScreen ? AFTER_POP_DELAY_MS : 0;
  const later = (run: () => void): void => {
    if (delay === 0) run();
    else setTimeout(run, delay);
  };
  switch (action) {
    case 'adjust_plan': {
      const intents = useIntentStore.getState();
      intents.parkCoachProgram({ kind: 'adjust' });
      intents.requestTab('Coach');
      return;
    }
    case 'change_days': {
      const program = useHealthStore.getState().today?.program;
      if (!program || !isLiveStatus(program.status)) return;
      later(() =>
        openChangeDays({
          kind: 'program',
          programId: program.id,
          daysPerWeek: program.daysPerWeek ?? 3,
          selected: program.trainingDays ?? [],
          onSaved: () => void reloadPlan({ force: true }),
        }),
      );
      return;
    }
    case 'log_meal':
      later(() => openPlanMealCapture('search', todayServerDay()));
      return;
  }
}
