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
 *
 * Each link that carries credentials is tried once per phone
 * (./spentLinks.ts): Android hands the link that started the app back again
 * when it reopens from Recents after a process death, and a second exchange
 * could revoke the session the first one made. A link that failed runs (and
 * raises its banner) every time, as on iOS.
 *
 * NOT EVERY `lifepass://auth/` LINK IS AN EMAIL LINK. F4's router sends every
 * `lifepass://auth/...` link here, and on Android that includes the Google
 * and Apple sign-in page's own return, `lifepass://auth/callback/social...`
 * (AUTH-2, src/features/auth/social.ts). On iOS the web-auth session catches
 * that return itself and it never reaches `handleIncomingURL`. Here it does,
 * and it is not ours: it carries a code bound to AUTH-2's own verifier, so
 * our exchange could only fail, and it would use up the reset marker, raise
 * a false "couldn't confirm your email" banner and pull the member to Log in
 * in the middle of a sign-in that is working. Such a link is handed to
 * AUTH-2 (`completeSocialReturn`) and nothing else is done with it.
 */
import { t } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { consumeRecoveryRequested, exchangeAuthLink } from '../../supabase/services/auth';

import { beginPasswordRecovery } from './recovery';
import { claimAuthLink } from './spentLinks';

/** The Google and Apple sign-in page's return (AUTH-2 `SOCIAL_RETURN_URL`), before its query. */
export const SOCIAL_RETURN_PREFIX = 'lifepass://auth/callback/social';

/**
 * Whether a link is the social sign-in page's return, or anything below its
 * path: the same test as AUTH-2's `isSocialReturnUrl`, kept here so the
 * email-link handler never depends on AUTH-2's module to stay out of its way.
 */
export function isSocialReturnLink(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.slice(0, SOCIAL_RETURN_PREFIX.length).toLowerCase() !== SOCIAL_RETURN_PREFIX) return false;
  const next = trimmed.charAt(SOCIAL_RETURN_PREFIX.length);
  return next === '' || next === '?' || next === '#' || next === '/';
}

/** Links being handled now: the same link delivered twice (launch and event) is handled once. */
const inFlight = new Map<string, Promise<void>>();

/** Completes a sign-in from an auth link. Never throws: a failure is shown on the Log in screen. */
export function handleAuthCallback(url: string): Promise<void> {
  // Before anything else: no claim, no marker read, no exchange, no banner.
  // It is AUTH-2's (`completeSocialReturn(url)` in ./social, wired when
  // AUTH-2 merges). Until then it is left alone: the open sign-in page
  // catches its own return, and a cold start finishes it from the sign-in
  // screen (`resumeSocialSignIn`).
  if (isSocialReturnLink(url)) return Promise.resolve();
  const running = inFlight.get(url);
  if (running) return running;
  const work = handle(url).finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, work);
  return work;
}

async function handle(url: string): Promise<void> {
  // A link with credentials already tried on this phone: a replay of the launch link. Nothing to do, nothing to say.
  if (!(await claimAuthLink(url))) return;
  const saysRecovery = url.includes('type=recovery');
  const markerSaysRecovery = await consumeRecoveryRequested();
  let isRecovery = saysRecovery || markerSaysRecovery;
  try {
    const exchanged = await exchangeAuthLink(url);
    isRecovery = isRecovery || exchanged.recovery;
    const session = exchanged.session;
    // Up before the sign-in runs, so nothing the sign-in arms can cover it.
    if (isRecovery) beginPasswordRecovery(session.user.id);
    // Android: a link that worked retires the banner an earlier failed one
    // left (iOS keeps it until the email is edited, so it would greet the
    // member again at their next sign-out).
    if (useAppStore.getState().deepLinkError !== null) useAppStore.getState().setDeepLinkError(null);
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
