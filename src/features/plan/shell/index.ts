/**
 * The Plan tab's shell (PLAN-1): what every Plan section, sheet and pushed
 * screen builds on. iOS keeps all of this in PlanView.swift; the cards get
 * it as closures. Android sections take no props (plan 3.0.3), so they call
 * these instead:
 *
 *   import { usePlanView, reloadPlan, applySessionAction, selectPlanDate } from '../shell';
 *
 *   const { shownDay, isReadOnly, isOffline, isShowingToday } = usePlanView();
 *   onActionResult: (response) => applySessionAction(response)   // PLAN-2, PLAN-3
 *   onReload / onProgramUpdated: () => reloadPlan({ force: true })  // every card
 *   onBackToToday: () => selectPlanDate(todayServerDay())          // PLAN-5
 *   onResumePlan / pause / end: setProgramStatus(status, id)        // PLAN-2, PLAN-4
 *   onPresentRunner: (session) => presentPlanRunner(session)        // PLAN-2, PLAN-4
 *   onScan / onAdd / Log a meal: openPlanMealCapture(mode, date)    // PLAN-5
 *   a modal whose close re-reads (the classes sheet): reloadPlanOnNextFocus()
 *
 * Packages that land after Plan plug in through ./bridges.ts:
 * `installPlanOutbox` (RUN-1, MEAL-1), `installPlanFeedback` (FEED-1),
 * `installWeeklyCheckInOpener` (PLAN-5).
 *
 * The status mark and the status word the week strip draws are shared with
 * the plan overview and the history (../week).
 */
export { planActionAnswer, type PlanActionAnswer } from './actionAnswer';
export { ADOPTED_BANNER_KEYS, adoptedBannerKey, readAdoptedBannerKey, reminderDeniedKey, type AdoptedBannerKey } from './adoptedBanner';
export {
  installPlanFeedback,
  installPlanOutbox,
  installWeeklyCheckInOpener,
  usePlanBridges,
  type PlanFeedbackBridge,
  type PlanFeedbackLoadState,
  type PlanOutboxItem,
  type PlanOutboxKind,
  type PlanOutboxSource,
  type WeeklyCheckInEntry,
} from './bridges';
export { canAnswerPlanAction, isParkedActionExpired, scrollDecision } from './parkedActions';
export {
  applySessionAction,
  movePlanWeek,
  openPlanMealCapture,
  openPlanModal,
  popPlanToRoot,
  presentPlanRunner,
  pushPlanRoute,
  reloadPlan,
  reloadPlanOnNextFocus,
  requestPlanScroll,
  selectPlanDate,
  setProgramStatus,
  supportsFeedbackNow,
  usePlanShell,
} from './planShell';
export { computePlanView, currentPlanView, usePlanView, type PlanViewModel } from './planView';
export {
  hasProgramToShow,
  PLAN_SECTION_ANCHORS,
  planSectionAnchor,
  resolvePlanSection,
  type PlanSection,
  type PlanSectionAnchor,
} from './sectionRule';
export { sessionKindIcon, type SessionKindIcon } from './sessionKindIcon';
