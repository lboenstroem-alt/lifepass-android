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
 * - A LANGUAGE CHANGE: the other remembered dates go, their server copy is
 *   in the old language.
 *
 * Loaded with every feature's register file (src/app/registrations.ts), so
 * the hooks are in place before the first sign-in or sign-out.
 */
import { registerProfileReadHook, registerSignOutCleaner } from '../app/signOut';
import { useAppStore } from '../stores/appStore';

import { memberForSignOutWipe, useHealthStore, wipeWithoutMember } from './store';

registerSignOutCleaner('health.wipe', async ({ memberId }) => {
  const id = await memberForSignOutWipe(memberId);
  if (id) await useHealthStore.getState().wipeLocal({ profileId: id, reason: 'signout' });
  else await wipeWithoutMember();
});

registerProfileReadHook('health.reconcile', ({ profile }) => useHealthStore.getState().reconcile(profile));

let languageSeen = useAppStore.getState().language;
useAppStore.subscribe((state) => {
  if (state.language === languageSeen) return;
  languageSeen = state.language;
  useHealthStore.getState().forgetOtherDays();
});
