// Session hooks for the monthly feedback (iOS AppState.wireFeedback,
// handleSignOut, ContentView.activateHealth and AuthViewModel.signOut call
// these by name). Imported once at startup by src/app/registrations.ts.
//
// - PRE-SIGN-OUT: a safety food-off the phone could not send yet gets one
//   short try (at most 3 s, and only when one is waiting) while the session
//   still stands. What does not get through is kept by the sign-out wipe
//   (`FeedbackKeys.keptOnSignOut`) and goes first at the member's next
//   sign-in.
// - SIGN-OUT and EVERY HEALTH WIPE (withdrawal here or elsewhere, a minor, an
//   account deletion): the summary in memory goes. The stored flags are the
//   health wipe's (src/health/store.ts `removeFeedbackKeys`), which keeps only
//   a pending safety food-off, and only at a sign-out.
// - EVERY ACTIVATION (the first profile read of a sign-in, each return to the
//   foreground): the throttled read, which sends a pending food-off first. A
//   read is never a prompt.
// - Plan's bridge (src/features/plan, `installPlanFeedback`): the load
//   sequence's feedback read, the notification taps and the scroll to the card.
import { registerActivationHook, registerPreSignOutHook, registerSignOutCleaner } from '../../app/signOut';
import { registerHealthWipeHook } from '../../health/wipe';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { installPlanFeedback, type PlanFeedbackBridge } from '../plan';

import { installFeedbackNotifications } from './backgroundJob';
import { isCardEmpty } from './cardState';
import { feedbackCardStateNow } from './cardStateNow';
import { feedbackEnvironment, supportsFeedback, useFeedbackStore } from './feedbackStore';

registerPreSignOutHook('feedback.food-off', () => useFeedbackStore.getState().sendPendingFoodOffBeforeSignOut());

registerSignOutCleaner('feedback.summary', () => useFeedbackStore.getState().wipe());

registerHealthWipeHook('feedback.summary', () => useFeedbackStore.getState().wipe());

registerActivationHook('feedback.activate', async () => {
  if (!feedbackEnvironment()?.eligible) return;
  await useFeedbackStore.getState().refresh();
});

/** The card has something to draw for the member now (iOS `!feedbackCardState(...).isEmpty`). */
function hasCardContent(): boolean {
  const app = useAppStore.getState();
  if (!app.profile || !supportsFeedback(app) || !selectHasHealthConsent(app)) return false;
  return !isCardEmpty(feedbackCardStateNow());
}

export const planFeedbackBridge: PlanFeedbackBridge = {
  isAvailable: () => !useFeedbackStore.getState().isHidden(useAppStore.getState().serverFeatures),
  refresh: (force) => useFeedbackStore.getState().refresh({ force }),
  loadState: () => useFeedbackStore.getState().loadState.kind,
  latestCurrentReportId: () => {
    const latest = useFeedbackStore.getState().summary?.latest;
    return latest && latest.current ? latest.id : null;
  },
  hasCardContent,
  subscribe: (listener) => useFeedbackStore.subscribe(() => listener()),
};

installPlanFeedback(planFeedbackBridge);

// The notifications and the background refresh (NOTIF-2, ./backgroundJob.ts):
// the sync after every change and activation, and the WorkManager job, which
// a headless run finds here too (src/background/task.ts loads this file).
installFeedbackNotifications();
