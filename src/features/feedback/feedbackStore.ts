/**
 * The app's one feedback store, wired to the app the way iOS
 * `AppState.wireFeedback` wires `FeedbackStore`:
 *
 * - the environment: the signed-in member (a loaded profile), the account
 *   language, and whether the feature may be used at all
 *   (`supportsFeedback && hasHealthConsent`);
 * - every answer's `features` goes to the app store (last writer wins);
 * - a consent or age refusal goes to the health store as a BACKGROUND problem,
 *   which reconciles and never presents a sheet;
 * - a change the notifications depend on is announced (./changes.ts).
 *
 * `supportsFeedback` is iOS `AppState.supportsFeedback`: the server
 * advertises `health_feedback`, and FB-1 has not answered 404 under the
 * feature list the app holds now (the store's stale flag).
 */
import { HealthServerFeature } from '../../health/models';
import { useHealthStore } from '../../health/store';
import { removeEverywhere } from '../../notifications/scheduler';
import { selectHasHealthConsent, useAppStore, type AppStoreState } from '../../stores/appStore';

import { notifyFeedbackChanged } from './changes';
import { createFeedbackStore, type FeedbackEnvironment } from './store';

/** Every notification the monthly feedback schedules (NOTIF-2) starts with this. */
export const FEEDBACK_NOTIFICATION_PREFIX = 'health.feedback.';

export const useFeedbackStore = createFeedbackStore({
  environment: feedbackEnvironment,
  onServerFeatures: (features) => useAppStore.getState().noteServerFeatures(features),
  onProblem: (error) => {
    useHealthStore.getState().handle(error, { foreground: false });
  },
  onChanged: notifyFeedbackChanged,
  removeNotifications: () => removeEverywhere(FEEDBACK_NOTIFICATION_PREFIX),
});

type FeatureSlice = Pick<AppStoreState, 'serverFeatures'>;

/** iOS `AppState.supportsFeedback`. */
export function supportsFeedback(app: FeatureSlice = useAppStore.getState()): boolean {
  return app.serverFeatures.includes(HealthServerFeature.feedback) && !useFeedbackStore.getState().isHidden(app.serverFeatures);
}

/** `supportsFeedback`, re-rendering when the feature list or the stale flag changes. */
export function useSupportsFeedback(): boolean {
  const serverFeatures = useAppStore((s) => s.serverFeatures);
  const staleFeatures = useFeedbackStore((s) => s.staleFeatures);
  // `staleFeatures` is read so the hook re-renders when it changes.
  void staleFeatures;
  return supportsFeedback({ serverFeatures });
}

/** What the store needs for one call: null without a signed-in member whose profile has loaded. */
export function feedbackEnvironment(): FeedbackEnvironment | null {
  const app = useAppStore.getState();
  const profileId = app.profile?.id;
  if (!app.isAuthenticated || !profileId) return null;
  return {
    profileId,
    language: app.language,
    eligible: supportsFeedback(app) && selectHasHealthConsent(app),
    features: app.serverFeatures,
  };
}
