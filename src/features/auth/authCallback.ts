/**
 * The email-confirmation and password-reset link (plan 3.0.3 contract,
 * called by F4's deep-link router, src/app/deepLinks.ts): the Android port of
 * the auth branch of iOS `LifePassApp.handleIncomingURL`.
 *
 * Both forms arrive here (D23): the App Link
 * `https://www.lifepass.is/app/auth-callback` and the custom scheme
 * `lifepass://auth/callback`, with the tokens in the fragment (implicit flow)
 * or a `code` in the query (PKCE). The link becomes a session
 * (`exchangeAuthLink`), and then:
 *
 * - A CONFIRMATION signs the member in (`handleSignIn`, which arms the Kenni
 *   nudge for a fresh unverified account): they land in the app signed in.
 * - A RECOVERY (reset) link must show the set-new-password screen; the
 *   exchange alone would sign the member in with the OLD password unchanged,
 *   which is what the first Android build did. It is a recovery when the
 *   link says `type=recovery` (we ask Supabase to keep it on the return), or
 *   the phone's "reset requested" marker is under an hour old (a PKCE return
 *   carries only `?code=`), or Supabase's PKCE exchange says so. The sign-in
 *   suppresses the Kenni nudge: both would arm in the same turn, and the
 *   nudge's sheet would hide the security-critical screen (iOS
 *   `handleSignIn(userId:suppressKennitalaPrompt: isRecovery)`).
 * - A link that fails (expired, used, tampered, offline) signs nobody in and
 *   leaves a banner for the Log in screen (`deepLinkError`), which the
 *   sign-in screens route to. A failed RECOVERY says to request a new reset
 *   email, not to sign in.
 *
 * Recovery is decided ONCE, before the exchange: the marker read is
 * one-shot and both outcomes need it. Unlike iOS (whose `||` skips the read
 * when the link already says `type=recovery`), the marker is always read,
 * so a reset link consumes it and a later confirmation link within the hour
 * is not mistaken for a reset.
 */
import { t } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { consumeRecoveryRequested, exchangeAuthLink } from '../../supabase/services/auth';

import { beginPasswordRecovery } from './recovery';

/** Links being handled now: the same link delivered twice (launch and event) is handled once. */
const inFlight = new Map<string, Promise<void>>();

/** Completes a sign-in from an auth link. Never throws: a failure is shown on the Log in screen. */
export function handleAuthCallback(url: string): Promise<void> {
  const running = inFlight.get(url);
  if (running) return running;
  const work = handle(url).finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, work);
  return work;
}

async function handle(url: string): Promise<void> {
  const saysRecovery = url.includes('type=recovery');
  const markerSaysRecovery = await consumeRecoveryRequested();
  let isRecovery = saysRecovery || markerSaysRecovery;
  try {
    const exchanged = await exchangeAuthLink(url);
    isRecovery = isRecovery || exchanged.recovery;
    const session = exchanged.session;
    // Up before the sign-in runs, so nothing the sign-in arms can cover it.
    if (isRecovery) beginPasswordRecovery();
    await useAppStore.getState().handleSignIn(session.user.id, {
      session,
      ...(isRecovery ? { suppressKennitalaPrompt: true } : {}),
    });
  } catch {
    useAppStore.getState().setDeepLinkError(t(isRecovery ? 'auth.deeplink_err_recovery' : 'auth.deeplink_err_confirm'));
  }
}

/** Forget links in flight (tests). */
export function resetAuthCallbackForTests(): void {
  inFlight.clear();
}
