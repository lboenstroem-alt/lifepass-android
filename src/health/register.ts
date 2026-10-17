/**
 * The health store's session hooks (iOS `AppState.handleSignOut` and
 * `AppState.loadProfile` call them by name):
 *
 * - SIGN-OUT: the local wipe, for the member who left. The id comes from the
 *   sign-out (the profile, else the session's user: often the profile never
 *   loaded, after an offline cold start), else whatever the store or the
 *   wearable marker last knew. With nobody to name, the health
 *   notifications, the feedback's member and the background task still go.
 * - EVERY PROFILE READ: `reconcile`, which wipes when consent is gone or the
 *   member is a verified minor (src/health/store.ts).
 * - EVERY ACTIVATION (the first profile read of a sign-in, each return to
 *   the foreground): the Today read, for a member with consent, entitled,
 *   with a live plan (iOS `ContentView.activateHealth`: the reminder
 *   planner and Home's Today row plan from it; inside the freshness window
 *   it costs nothing). Never a prompt.
 * - A LANGUAGE CHANGE: the other remembered dates go, their server copy is
 *   in the old language.
 *
 * Loaded with every feature's register file (src/app/registrations.ts), so
 * the hooks are in place before the first sign-in or sign-out.
 */
import { registerActivationHook, registerProfileReadHook, registerSignOutCleaner } from '../app/signOut';
import { useAppStore } from '../stores/appStore';

import { resetHealthConsentPresenter } from './consent/presenter';
import { resetMealGatePresenter } from './gate/mealGate';
import { isLiveStatus } from './models';
import { memberForSignOutWipe, selectHasLiveProgram, useHealthStore, wipeWithoutMember } from './store';

registerSignOutCleaner('health.wipe', async ({ memberId }) => {
  const id = await memberForSignOutWipe(memberId);
  if (id) await useHealthStore.getState().wipeLocal({ profileId: id, reason: 'signout' });
  else await wipeWithoutMember();
});

// A consent sheet or a meal gate opened for the member who left must not
// greet the next one (iOS drops them with the signed-in views).
registerSignOutCleaner('health.sheets', () => {
  resetHealthConsentPresenter();
  resetMealGatePresenter();
});

registerProfileReadHook('health.reconcile', ({ profile }) => useHealthStore.getState().reconcile(profile));

registerActivationHook('health.activate', async () => {
  const app = useAppStore.getState();
  const profile = app.profile;
  if (!app.isAuthenticated || !profile) return;
  const hasPlan = selectHasLiveProgram(useHealthStore.getState()) || isLiveStatus(profile.health?.program?.status ?? null);
  if (profile.health?.consent && app.healthAccess === 'entitled' && hasPlan) {
    await useHealthStore.getState().load({ profile, language: app.language });
  }
});

let languageSeen = useAppStore.getState().language;
useAppStore.subscribe((state) => {
  if (state.language === languageSeen) return;
  languageSeen = state.language;
  useHealthStore.getState().forgetOtherDays();
});
