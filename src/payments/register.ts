/**
 * The payment rails' session hooks (F3's registry, src/app/signOut.ts),
 * loaded with every feature's register file by src/app/registrations.ts.
 *
 * - Sign-out wipes every in-flight record and the waiting return link: a
 *   payment of one member's must never surface for the next person who signs
 *   in on this phone.
 * - The first profile of a launch or sign-in, and every return to the
 *   foreground, resolves the member's attempts the app lost track of
 *   (./coldStartRecovery). At launch the link the app was started with is
 *   read first, so a cold start from `lifepass://payment-canceled` asks once,
 *   as the cancel leg does.
 */
import { registerActivationHook, registerSignOutCleaner } from '../app/signOut';

import { forgetPendingReturn, readLaunchReturnOnce, recoverPayments } from './coldStartRecovery';
import { wipeInflight } from './inflight';

registerSignOutCleaner('payments.inflight', async () => {
  forgetPendingReturn();
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
