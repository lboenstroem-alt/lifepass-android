/**
 * The payment rails' session hooks (F3's registry, src/app/signOut.ts).
 *
 * LOADED WITH THE SESSION HOOKS: src/app/registrations.ts (F3's) lists this
 * file as a SHARED_LAYERS entry, `payments: () => require('../payments/register')`,
 * loaded in its own try (F3 contract request; F8 does not edit that file).
 * Until that line is in, nothing wipes the in-flight records at a sign-out
 * and nothing recovers a payment after process death.
 *
 * - Sign-out wipes every in-flight record, the waiting return link, the
 *   outcomes waiting to be shown, the payments just settled and the
 *   "Confirming your payment…" overlay: a payment of one member's must never
 *   surface for the next person who signs in on this phone.
 * - The first profile of a launch or sign-in, and every return to the
 *   foreground, resolves the member's attempts the app lost track of
 *   (./coldStartRecovery). At launch the link the app was started with is
 *   read first, so a cold start from `lifepass://payment-canceled` asks once,
 *   as the cancel leg does. F3's activation hooks are background work
 *   that may fire while the launch or sign-in screens are up, so nothing is
 *   presented on the spot: an outcome waits until the app's tabs are on
 *   screen (./presenters; F3 contract request to say so in its registry).
 * - Every `lifepass://payment-*` and `card-setup-*` link the deep-link
 *   router sees (src/app/deepLinks.ts) comes here, each time one arrives,
 *   as iOS `LifePassApp.handleIncomingURL` hands each to its confirm. The
 *   once-per-process launch read above is not enough on Android: when it
 *   destroys the Activity but keeps the process (back on the first screen
 *   on Android 11 and older, memory pressure, "Don't keep activities"), the
 *   next return reaches the app only through the router, and without this
 *   its leg (success or cancel) was dropped: a cancelled checkout was then
 *   asked as Done and could end in "contact support". A return that came
 *   before this file loaded waits in the router and is handed over here.
 */
import { registerReturnHandler } from '../app/deepLinks';
import { registerActivationHook, registerSignOutCleaner } from '../app/signOut';

import { forgetPendingReturn, handlePaymentReturnUrl, readLaunchReturnOnce, recoverPayments } from './coldStartRecovery';
import { forgetRecentResolutions } from './earlier';
import { wipeInflight } from './inflight';
import { forgetWaitingPresentations } from './presenters';
import { resetRecoveryProgress } from './recoveryProgress';

registerSignOutCleaner('payments.inflight', async () => {
  forgetPendingReturn();
  forgetWaitingPresentations();
  forgetRecentResolutions();
  resetRecoveryProgress();
  await wipeInflight();
});

registerActivationHook('payments.recovery', async ({ memberId, trigger }) => {
  if (trigger === 'profile') {
    await readLaunchReturnOnce();
    await recoverPayments(memberId, 'launch');
    return;
  }
  await recoverPayments(memberId, 'foreground');
});

registerReturnHandler('payment', (hostedReturn) => {
  handlePaymentReturnUrl(hostedReturn.url);
});

registerReturnHandler('cardSetup', (hostedReturn) => {
  handlePaymentReturnUrl(hostedReturn.url);
});
