/**
 * The monthly feedback's public door (plan 3.0.3; FEED-1): what other
 * packages may use.
 *
 * - `turnOffFoodForSafety()` and `turnsOffFeedbackFoodOnRefusal()` for the
 *   Coach's programme wizard and Adjust my plan (COACH-4, COACH-5), below.
 * - `useFeedbackStore`, `supportsFeedback`, `subscribeFeedbackChanges` and
 *   `FEEDBACK_NOTIFICATION_PREFIX` for the feedback notifications and the
 *   background refresh (NOTIF-2).
 * - The card, the report and the history views, and the history sheet, for
 *   Plan's section and Body and goals' switches (both FEED-1's own slots).
 */
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';

import { supportsFeedback, useFeedbackStore } from './feedbackStore';
import { shouldTurnOffFoodForSafety } from './store';

export {
  AFTER_POP_DELAY_MS,
  performFeedbackAction,
  resolveFeedbackActionNow,
  tapFeedbackAction,
  useFeedbackActionResolver,
  type ShownFeedbackAction,
} from './actions';
export {
  EMPTY_CARD_STATE,
  FULL_CARD_DAYS,
  INTRO_BODY_WITHOUT_FOOD,
  INTRO_BODY_WITH_FOOD,
  feedbackActionLabelKey,
  isCardEmpty,
  resolveFeedbackAction,
  resolveFeedbackCardState,
  type FeedbackCardInput,
  type FeedbackCardState,
  type FeedbackMonthly,
} from './cardState';
export { feedbackCardStateNow, useFeedbackCardState } from './cardStateNow';
export { notifyFeedbackChanged, subscribeFeedbackChanges } from './changes';
export {
  FEEDBACK_NOTIFICATION_PREFIX,
  feedbackEnvironment,
  supportsFeedback,
  useFeedbackStore,
  useSupportsFeedback,
} from './feedbackStore';
export {
  FEEDBACK_FRESHNESS_WINDOW_MS,
  SIGN_OUT_FOOD_OFF_TIMEOUT_MS,
  createFeedbackStore,
  shouldTurnOffFoodForSafety,
  type FeedbackEnvironment,
  type FeedbackLoadState,
  type FeedbackLocalFlags,
  type FeedbackSettingName,
  type FeedbackStore,
  type FeedbackStoreDeps,
  type FeedbackStoreState,
} from './store';
export { default as FeedbackCard, type FeedbackCardProps } from './FeedbackCard';
export { default as FeedbackHistorySheet, type FeedbackHistorySheetProps } from './FeedbackHistorySheet';
export { default as FeedbackHistoryView, type FeedbackHistoryViewProps } from './FeedbackHistoryView';
export { default as FeedbackReportView, type FeedbackReportViewProps } from './FeedbackReportView';
export { useReappearCount, useScreenFocused } from './focus';

/**
 * Whether a local safety refusal in the Coach turns food and weight out of
 * the monthly feedback, and so whether the Coach says it did
 * ("program.refused.feedback_food_off", in the health lane): the server has
 * the feedback, consent stands, and the food switch is on, off only by
 * default, or not loaded yet (iOS `ProgramContext.turnsOffFeedbackFoodOnRefusal`).
 * The Coach reads this, then calls `turnOffFoodForSafety()`; it never sees a
 * setting and never sends the answer anywhere.
 */
export function turnsOffFeedbackFoodOnRefusal(): boolean {
  const app = useAppStore.getState();
  return (
    supportsFeedback(app) &&
    selectHasHealthConsent(app) &&
    shouldTurnOffFoodForSafety(useFeedbackStore.getState().summary?.settings)
  );
}

/**
 * Turns food and weight off in the monthly feedback after a safety answer
 * (iOS `FeedbackStore.turnOffFoodAndWeightForSafety`, SPEC 9.8). Sends
 * `{ "includeFoodAndWeight": false }` and nothing else: no reason, no answer,
 * no analytics event. Fire and forget: the pending flag goes down before the
 * request, a failure is retried on every foreground, a sign-out gives it one
 * short last try and keeps the flag for the member's next sign-in.
 */
export function turnOffFoodForSafety(): Promise<void> {
  return useFeedbackStore.getState().turnOffFoodAndWeightForSafety();
}
