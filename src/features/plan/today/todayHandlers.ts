/**
 * Where the Today card's taps go (iOS PlanView's closures for
 * `PlanTodayCard`, Views/Plan/PlanView.swift), wired to the Plan shell:
 *
 *   an action's answer     the shell patches day, week and upcoming
 *   Start, Resume          the runner on this session (`presentPlanRunner`)
 *   Resume another day's   whatever runner.json holds (`resumeSavedRunner`)
 *   Weekly check-in        PLAN-5's sheet, through the bridge
 *   Book a class           class discovery on the category and date; its
 *                          close reads the day again (a class booked there)
 *   View booking           Profile's bookings, on Plan's stack
 *   a sight, a soak, a pool their pages, on Plan's stack (iOS sheets)
 *   Start the next block   the Coach's programme wizard
 *   Resume plan            the programme back to active, then a read
 */
import type { SessionView } from '../../../health';
import { openRunner, refreshRunnerProgress, resumableWorkout } from '../../runner';
import { useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import {
  applySessionAction,
  openPlanModal,
  presentPlanRunner,
  pushPlanRoute,
  reloadPlan,
  reloadPlanOnNextFocus,
  setProgramStatus,
  usePlanBridges,
} from '../shell';

import type { TodayCardHandlers } from './TodayCard';

/**
 * Resume the workout `runner.json` holds, from the session it carries (a
 * "Do it now" left for later that Today names but no longer shows; iOS
 * `resumeSavedRunner`). A file that outlived its day is no workout to
 * resume: the Resume row is read again instead.
 */
export async function resumeSavedRunner(): Promise<void> {
  const saved = await resumableWorkout();
  if (!saved?.sessionId) {
    const app = useAppStore.getState();
    const memberId = app.profile?.id ?? app.userId;
    if (memberId) await refreshRunnerProgress(memberId);
    return;
  }
  // The runner's close reads the day again, as Start's does.
  reloadPlanOnNextFocus();
  openRunner({ id: saved.sessionId }, 'resume');
}

/** Class discovery on the session's category and date (iOS `.classes(session)`). */
export function openClassesForSession(session: Pick<SessionView, 'classCategory' | 'scheduledFor'>): void {
  // The sheet's close reads the day again: a class booked there is the session's booking.
  reloadPlanOnNextFocus();
  openPlanModal('ClassesDiscoveryModal', {
    initialCategory: session.classCategory ?? undefined,
    initialDate: session.scheduledFor ?? undefined,
  });
}

/** The Coach's programme wizard for the block after this one. */
export function startNextBlock(programId: string | null | undefined): void {
  if (!programId) return;
  const intents = useIntentStore.getState();
  intents.parkCoachProgram({ kind: 'nextBlock', programId });
  intents.requestTab('Coach');
}

/**
 * "Change with Coach" (COACH-6): the Coach, which asks what to change about
 * this day; the next words go to the plan change with the day as context.
 */
export function changeWithCoach(sessionId: string): void {
  const intents = useIntentStore.getState();
  intents.parkCoachPlanEdit({ sessionId });
  intents.requestTab('Coach');
}

/** The handlers for a card whose day belongs to `programId`. */
export function todayHandlers(programId: string | null): TodayCardHandlers {
  return {
    onActionResult: applySessionAction,
    onReload: () => void reloadPlan({ force: true }),
    onPresentRunner: (session) => void presentPlanRunner(session),
    onResumeSavedRunner: () => void resumeSavedRunner(),
    onPresentCheckIn: () => usePlanBridges.getState().weeklyCheckIn?.('plan'),
    onOpenClasses: openClassesForSession,
    onOpenBookings: () => pushPlanRoute('Profile', { initialTab: 'bookings' }),
    onOpenSight: (slug) => pushPlanRoute('AttractionDetail', { slug }),
    onOpenVenue: (slug) => pushPlanRoute('VenueDetail', { slug }),
    onStartNextBlock: () => startNextBlock(programId),
    onResumePlan: () => {
      if (programId) void setProgramStatus('active', programId);
    },
    onChangeWithCoach: (session) => changeWithCoach(session.id),
  };
}
