/**
 * The auth link (iOS `LifePassApp.handleIncomingURL`, auth branch): a
 * confirmation signs the member in; a reset ALWAYS shows set-new-password and
 * never just signs in, with the Kenni nudge kept off it; a failure leaves the
 * right banner for Log in, every time. Both link forms (D23), fragment and
 * PKCE. The social sign-in page's own return is not an email link and is
 * left alone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, Reply, supabase as authHost } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage, t } from '../../../i18n';
import {
  freshStorePerTest,
  MEMBER_A,
  PLUS_SUBSCRIPTION,
  profileJSON,
  sessionJSON,
  settle,
} from '../../../stores/__tests__/storeHarness';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../supabase/lib/client';
import { RECOVERY_REQUESTED_AT_KEY } from '../../../supabase/services/auth';
import { handleAuthCallback, isSocialReturnLink, resetAuthCallbackForTests } from '../authCallback';
import { RECOVERY_PENDING_KEY } from '../recovery';
import { SPENT_AUTH_LINKS_KEY } from '../spentLinks';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

/** A link carrying a live session for MEMBER_A, as the implicit flow returns it. */
function tokenLink(base: string, extra = ''): string {
  const session = sessionJSON(MEMBER_A, 3600);
  authHost.on('GET', '/auth/v1/user', Reply.json(200, session.user));
  return `${base}#access_token=${session.access_token}&expires_in=3600&refresh_token=${session.refresh_token}&token_type=bearer${extra}`;
}

beforeEach(() => {
  resetAuthCallbackForTests();
});

afterEach(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

describe('with the sign-in stubbed', () => {
  const handleSignIn = jest.fn(async (_userId: string, _options?: object) => undefined);
  let realHandleSignIn: ReturnType<typeof store>['handleSignIn'];

  beforeEach(() => {
    handleSignIn.mockClear();
    realHandleSignIn = store().handleSignIn;
    useAppStore.setState({ handleSignIn });
  });

  afterEach(() => {
    useAppStore.setState({ handleSignIn: realHandleSignIn });
  });

  describe('an email-confirmation link', () => {
    it('signs the member in, nudge and all', async () => {
      await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=signup'));
      expect(handleSignIn).toHaveBeenCalledTimes(1);
      const [userId, options] = handleSignIn.mock.calls[0]!;
      expect(userId).toBe(MEMBER_A);
      expect(options).not.toHaveProperty('suppressKennitalaPrompt');
      expect(store().pendingPasswordRecovery).toBe(false);
      expect(store().deepLinkError).toBeNull();
    });

    it('in its App Link form too', async () => {
      await handleAuthCallback(tokenLink('https://www.lifepass.is/app/auth-callback', '&type=signup'));
      expect(handleSignIn).toHaveBeenCalledWith(MEMBER_A, expect.objectContaining({ session: expect.anything() }));
    });

    it('as a PKCE code', async () => {
      // The server's yes is stubbed: for real it also needs the verifier of whoever asked for the email.
      authHost.on('POST', '/auth/v1/token', Reply.json(200, sessionJSON(MEMBER_A, 3600)));
      await handleAuthCallback('lifepass://auth/callback?code=abc');
      expect(handleSignIn).toHaveBeenCalledWith(MEMBER_A, expect.anything());
      expect(store().pendingPasswordRecovery).toBe(false);
    });

    it('that failed leaves the confirmation banner and signs nobody in', async () => {
      await handleAuthCallback(
        'lifepass://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      );
      expect(handleSignIn).not.toHaveBeenCalled();
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));
      expect(store().pendingPasswordRecovery).toBe(false);
    });

    it('whose session the server refuses leaves the banner too', async () => {
      authHost.on('GET', '/auth/v1/user', Reply.json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
      const session = sessionJSON(MEMBER_A, 3600);
      await handleAuthCallback(`lifepass://auth/callback#access_token=${session.access_token}&refresh_token=r`);
      expect(handleSignIn).not.toHaveBeenCalled();
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));
    });

    it('speaks the language on screen', async () => {
      setCurrentLanguage('is');
      await handleAuthCallback('lifepass://auth/callback#error=access_denied&error_code=otp_expired');
      expect(store().deepLinkError).toBe(lookup('auth.deeplink_err_confirm', 'is'));
    });

    it('delivered twice at once is handled once', async () => {
      const link = tokenLink('lifepass://auth/callback', '&type=signup');
      await Promise.all([handleAuthCallback(link), handleAuthCallback(link)]);
      expect(handleSignIn).toHaveBeenCalledTimes(1);
      expect(authHost.sentAll('/auth/v1/user', 'GET')).toHaveLength(1);
    });

    it('handed back again after Android restarted the app is left alone', async () => {
      const link = tokenLink('lifepass://auth/callback', '&type=signup');
      await handleAuthCallback(link);
      // A new process: Recents recreates the Activity with the link that started it.
      resetAuthCallbackForTests();
      await handleAuthCallback(link);
      expect(handleSignIn).toHaveBeenCalledTimes(1);
      expect(authHost.sentAll('/auth/v1/user', 'GET')).toHaveLength(1);
      expect(store().deepLinkError).toBeNull();
    });

    it('that failed raises its banner every time it comes, as on iOS', async () => {
      // Supabase's failure redirect is the same text for every expired link of a kind.
      const link =
        'lifepass://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
      await handleAuthCallback(link);
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));

      // The member closed the banner; the same link (or another expired one) comes again, in a new process.
      store().setDeepLinkError(null);
      resetAuthCallbackForTests();
      await handleAuthCallback(link);
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));
      expect(handleSignIn).not.toHaveBeenCalled();
    });

    it('that worked retires the banner an earlier failed one left', async () => {
      await handleAuthCallback('lifepass://auth/callback#error=access_denied&error_code=otp_expired');
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));
      await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=signup'));
      expect(handleSignIn).toHaveBeenCalledTimes(1);
      expect(store().deepLinkError).toBeNull();
    });
  });

  describe('a password-reset link', () => {
    it('signs in with the Kenni nudge suppressed and asks for the new password', async () => {
      await handleAuthCallback(tokenLink('lifepass://auth/callback?type=recovery', '&type=recovery'));
      expect(handleSignIn).toHaveBeenCalledWith(MEMBER_A, expect.objectContaining({ suppressKennitalaPrompt: true }));
      expect(store().pendingPasswordRecovery).toBe(true);
    });

    it('is shown BEFORE the sign-in runs, so nothing it arms can cover it', async () => {
      let pendingWhenSigningIn: boolean | null = null;
      handleSignIn.mockImplementationOnce(async () => {
        pendingWhenSigningIn = store().pendingPasswordRecovery;
      });
      await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=recovery'));
      expect(pendingWhenSigningIn).toBe(true);
    });

    it('in its App Link form too', async () => {
      await handleAuthCallback(tokenLink('https://www.lifepass.is/app/auth-callback?type=recovery'));
      expect(store().pendingPasswordRecovery).toBe(true);
    });

    it('is recognised by the phone marker when the link says nothing (a PKCE return)', async () => {
      await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(Date.now() / 1000 - 60));
      authHost.on('POST', '/auth/v1/token', Reply.json(200, sessionJSON(MEMBER_A, 3600)));
      await handleAuthCallback('lifepass://auth/callback?code=abc');
      expect(store().pendingPasswordRecovery).toBe(true);
      expect(handleSignIn).toHaveBeenCalledWith(MEMBER_A, expect.objectContaining({ suppressKennitalaPrompt: true }));
    });

    it('uses the marker once: the next link is a confirmation again', async () => {
      await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(Date.now() / 1000 - 60));
      await handleAuthCallback(tokenLink('lifepass://auth/callback?type=recovery'));
      useAppStore.setState({ pendingPasswordRecovery: false });
      expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBeNull();

      await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=signup'));
      expect(store().pendingPasswordRecovery).toBe(false);
    });

    it('ignores a marker an hour old', async () => {
      await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(Date.now() / 1000 - 3601));
      await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=signup'));
      expect(store().pendingPasswordRecovery).toBe(false);
    });

    it('that failed says to ask for a new reset email, and signs nobody in', async () => {
      await handleAuthCallback('lifepass://auth/callback?type=recovery#error=access_denied&error_code=otp_expired');
      expect(handleSignIn).not.toHaveBeenCalled();
      expect(store().pendingPasswordRecovery).toBe(false);
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_recovery'));
    });

    it('handed back again after Android restarted the app does not ask again', async () => {
      const link = tokenLink('lifepass://auth/callback?type=recovery', '&type=recovery');
      await handleAuthCallback(link);
      useAppStore.setState({ pendingPasswordRecovery: false });
      resetAuthCallbackForTests();
      await handleAuthCallback(link);
      expect(store().pendingPasswordRecovery).toBe(false);
      expect(handleSignIn).toHaveBeenCalledTimes(1);
    });

    it('that failed says so every time it comes', async () => {
      const link = 'lifepass://auth/callback?type=recovery#error=access_denied&error_code=otp_expired';
      await handleAuthCallback(link);
      store().setDeepLinkError(null);
      resetAuthCallbackForTests();
      await handleAuthCallback(link);
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_recovery'));
    });

    it('that failed after a marker says so too', async () => {
      await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(Date.now() / 1000 - 60));
      await handleAuthCallback('lifepass://auth/callback?error=server_error');
      expect(store().deepLinkError).toBe(t('auth.deeplink_err_recovery'));
    });
  });
});

describe("the Google and Apple sign-in page's return", () => {
  const SOCIAL_RETURNS = [
    'lifepass://auth/callback/social?attempt=a1&code=one-time-code',
    'lifepass://auth/callback/social?attempt=a1#error=access_denied&error_description=Cancelled',
    'lifepass://auth/callback/social',
    'lifepass://auth/callback/social/',
    'LIFEPASS://auth/callback/social?attempt=a1&code=c',
    ' lifepass://auth/callback/social#access_token=a&refresh_token=r ',
  ];

  it.each(SOCIAL_RETURNS)('is recognised: %s', (url) => {
    expect(isSocialReturnLink(url)).toBe(true);
  });

  it.each([
    'lifepass://auth/callback',
    'lifepass://auth/callback?type=recovery#access_token=a&refresh_token=r',
    'lifepass://auth/callback/socialx?code=c',
    'https://www.lifepass.is/app/auth-callback/social?code=c',
  ])('is not mistaken for an email link: %s', (url) => {
    expect(isSocialReturnLink(url)).toBe(false);
  });

  it.each(SOCIAL_RETURNS)('is left alone: no marker read, no claim, no request, no banner (%s)', async (url) => {
    const markerAt = String(Date.now() / 1000 - 60);
    await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, markerAt);
    const handleSignIn = jest.spyOn(store(), 'handleSignIn');

    await handleAuthCallback(url);
    await settle();

    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBe(markerAt);
    expect(await AsyncStorage.getItem(SPENT_AUTH_LINKS_KEY)).toBeNull();
    expect(authHost.requests).toHaveLength(0);
    expect(store().deepLinkError).toBeNull();
    expect(store().pendingPasswordRecovery).toBe(false);
    expect(handleSignIn).not.toHaveBeenCalled();
    handleSignIn.mockRestore();
  });

  it('does not clear a banner an email link left', async () => {
    await handleAuthCallback('lifepass://auth/callback#error=access_denied&error_code=otp_expired');
    await handleAuthCallback('lifepass://auth/callback/social?attempt=a1&code=c');
    expect(store().deepLinkError).toBe(t('auth.deeplink_err_confirm'));
  });
});

describe('with the real sign-in, for a fresh unverified account', () => {
  beforeEach(() => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: false, createdAt: new Date().toISOString() })));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
  });

  it('a confirmation link lands the member in the app, with the Kenni nudge', async () => {
    await handleAuthCallback(tokenLink('lifepass://auth/callback', '&type=signup'));
    await settle();
    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(store().pendingKennitalaPrompt).toBe(true);
    expect(store().pendingPasswordRecovery).toBe(false);
  });

  it('a reset link never just signs in: set-new-password, and no nudge over it', async () => {
    await handleAuthCallback(tokenLink('lifepass://auth/callback?type=recovery', '&type=recovery'));
    await settle();
    expect(store().isAuthenticated).toBe(true);
    expect(store().pendingPasswordRecovery).toBe(true);
    expect(store().pendingKennitalaPrompt).toBe(false);
    // Written down for a restart, and kept through the link's own sign-in.
    const mark = JSON.parse((await AsyncStorage.getItem(RECOVERY_PENDING_KEY)) ?? 'null') as { userId: string } | null;
    expect(mark?.userId).toBe(MEMBER_A);
  });

  it('a nudge armed by another sign-in is held back while the screen is up', async () => {
    await handleAuthCallback(tokenLink('lifepass://auth/callback?type=recovery', '&type=recovery'));
    await settle();
    // The launch's own sign-in of the same member (a cold start from the link) does not know it is a recovery.
    await store().handleSignIn(MEMBER_A);
    await settle();
    expect(store().pendingKennitalaPrompt).toBe(false);
    expect(store().pendingPasswordRecovery).toBe(true);
  });
});
