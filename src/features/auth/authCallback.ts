// @f4-stub (plan 3.0.3): the email-confirmation and password-reset link.
//
// Filled by AUTH-1. Called by F4's deep-link router (src/app/deepLinks.ts)
// for BOTH forms (D23): the App Link `https://www.lifepass.is/app/auth-callback`
// and the custom scheme `lifepass://auth/callback`, query or fragment.
// Keep the exported name and signature; replace the body.
//
// What AUTH-1 ports (iOS LifePassApp.handleIncomingURL): recovery detection
// (`type=recovery` or the local "reset requested" marker, read once), the
// session exchange, `handleSignIn(userId, { suppressKennitalaPrompt })` for a
// recovery, `setPendingPasswordRecovery(true)`, and on failure the login
// screen's banner (`auth.deeplink_err_recovery` / `auth.deeplink_err_confirm`).
//
// Until then this bridges to the first build's exchange, which takes the
// tokens from the link; the app store's SIGNED_IN listener runs the sign-in.
// A RECOVERY link runs the sign-in itself, with the post-sign-up Kenni nudge
// suppressed (iOS `handleSignIn(userId:suppressKennitalaPrompt: isRecovery)`):
// for a fresh unverified account both sheets would arm in the same turn, and
// the nudge would hide the security-critical set-new-password screen. The
// link's own SIGNED_IN joins this sign-in (the app store treats a second call
// for the same member while one runs as the same sign-in).
import { t } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../supabase/lib/client';
import { AUTH_CALLBACK_URL, completeAuthFromUrl } from '../../supabase/services/auth';

/** The tokens and flags of either link form, carried over to the custom-scheme form the exchange reads. */
function asCustomSchemeLink(url: string): string {
  const start = url.search(/[?#]/);
  return start < 0 ? AUTH_CALLBACK_URL : `${AUTH_CALLBACK_URL}${url.slice(start)}`;
}

/** The member the exchange just signed in, or null. */
async function signedInUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Completes a sign-in from an auth link. Never throws: a failure is shown on the sign-in screen. */
export async function handleAuthCallback(url: string): Promise<void> {
  const isRecovery = url.includes('type=recovery');
  try {
    const exchanged = await completeAuthFromUrl(asCustomSchemeLink(url));
    if (isRecovery) {
      const userId = exchanged ? await signedInUserId() : null;
      if (userId) await useAppStore.getState().handleSignIn(userId, { suppressKennitalaPrompt: true });
      useAppStore.getState().setPendingPasswordRecovery(true);
    }
  } catch {
    useAppStore.getState().setDeepLinkError(t(isRecovery ? 'auth.deeplink_err_recovery' : 'auth.deeplink_err_confirm'));
  }
}
