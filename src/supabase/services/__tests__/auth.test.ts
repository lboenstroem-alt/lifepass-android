/**
 * The email auth service against the stub auth server: what sign-up sends
 * (iOS APIClientAuthTests `testTheAppsSignupSourceIsIos`, here 'android'),
 * where the emails send the member back (D23), the reset marker (one hour,
 * read once), and turning an auth link into a session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Reply, supabase as authHost } from '@test/server';

import { setCurrentLanguage } from '../../../i18n';
import { sessionJSON } from '../../../stores/__tests__/storeHarness';
import { supabase } from '../../lib/client';
import {
  AUTH_APP_LINK_URL,
  AUTH_CALLBACK_URL,
  AUTH_EMAIL_REDIRECT,
  authLinkParams,
  AuthLinkError,
  consumeRecoveryRequested,
  exchangeAuthLink,
  RECOVERY_REQUESTED_AT_KEY,
  recoveryRedirect,
  resetPassword,
  SIGNUP_SOURCE,
  signUp,
  signUpMetadata,
  updatePassword,
} from '../auth';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

afterEach(async () => {
  // A session a test made stays in the SDK's memory otherwise.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

describe('sign-up metadata', () => {
  it('says the account came from the Android app (D2)', () => {
    expect(SIGNUP_SOURCE).toBe('android');
  });

  it('has exactly the iOS keys, nationality included when set', () => {
    const data = signUpMetadata({ fullName: 'Jón Jónsson', marketingOptIn: true, locale: 'is', nationality: 'IS' });
    expect(data).toEqual({
      full_name: 'Jón Jónsson',
      marketing_opt_in: true,
      signup_source: 'android',
      locale: 'is',
      nationality: 'IS',
    });
  });

  it('leaves nationality out when unset, never as an empty string, and always carries locale', () => {
    for (const nationality of [undefined, null, '']) {
      const data = signUpMetadata({ fullName: 'Anna', marketingOptIn: false, locale: 'en', nationality });
      expect(Object.keys(data).sort()).toEqual(['full_name', 'locale', 'marketing_opt_in', 'signup_source']);
      expect(data.locale).toBe('en');
    }
  });
});

describe('signUp', () => {
  it('sends the metadata, the language on screen, and the app as the return', async () => {
    setCurrentLanguage('is');
    authHost.on('POST', '/auth/v1/signup', Reply.json(200, { id: MEMBER, email: 'member@example.is', aud: 'authenticated' }));

    const result = await signUp('member@example.is', 'a long password ', 'Jón', 'IS', false);

    expect(result.session).toBeNull();
    const sent = authHost.sent('/auth/v1/signup', 'POST');
    const body = sent.body as { email: string; password: string; data: Record<string, unknown> };
    expect(body.email).toBe('member@example.is');
    expect(body.password).toBe('a long password ');
    expect(body.data).toEqual({
      full_name: 'Jón',
      marketing_opt_in: false,
      signup_source: 'android',
      locale: 'is',
      nationality: 'IS',
    });
    // D23: the custom scheme until the App Link's web page exists.
    expect(sent.query.redirect_to).toBe('lifepass://auth/callback');
  });

  it('returns the session when the project does not ask for a confirmation', async () => {
    authHost.on('POST', '/auth/v1/signup', Reply.json(200, sessionJSON(MEMBER, 3600)));
    const result = await signUp('member@example.is', 'a long password', 'Jón', undefined, false, 'en');
    expect(result.session?.user.id).toBe(MEMBER);
    expect((authHost.sent('/auth/v1/signup', 'POST').body as { data: object }).data).not.toHaveProperty('nationality');
  });

  it('throws what Supabase refused', async () => {
    authHost.on(
      'POST',
      '/auth/v1/signup',
      Reply.json(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }),
    );
    await expect(signUp('member@example.is', 'a long password', 'Jón', undefined, false)).rejects.toThrow(
      'email rate limit exceeded',
    );
  });
});

describe('where the emails return (D23)', () => {
  it('is the custom scheme for now; the App Link is known and handled', () => {
    expect(AUTH_EMAIL_REDIRECT).toBe(AUTH_CALLBACK_URL);
    expect(AUTH_CALLBACK_URL).toBe('lifepass://auth/callback');
    expect(AUTH_APP_LINK_URL).toBe('https://www.lifepass.is/app/auth-callback');
    expect(recoveryRedirect()).toBe('lifepass://auth/callback?type=recovery');
    expect(recoveryRedirect(AUTH_APP_LINK_URL)).toBe('https://www.lifepass.is/app/auth-callback?type=recovery');
  });
});

describe('the reset request', () => {
  it('marks the phone first, then asks for a link that keeps type=recovery', async () => {
    authHost.on('POST', '/auth/v1/recover', Reply.json(200, {}));
    await resetPassword('member@example.is', () => 1_700_000_000_000);

    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBe('1700000000');
    const sent = authHost.sent('/auth/v1/recover', 'POST');
    expect((sent.body as { email: string }).email).toBe('member@example.is');
    expect(sent.query.redirect_to).toBe('lifepass://auth/callback?type=recovery');
  });

  it('throws what Supabase refused, the marker already written', async () => {
    authHost.on('POST', '/auth/v1/recover', Reply.json(500, { code: 500, error_code: 'unexpected_failure', msg: 'boom' }));
    await expect(resetPassword('member@example.is')).rejects.toThrow();
    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).not.toBeNull();
  });
});

describe('the reset marker (iOS consumeRecoveryRequested)', () => {
  const now = () => 1_700_000_000_000;

  it('counts under an hour, once', async () => {
    await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(1_700_000_000 - 3599));
    expect(await consumeRecoveryRequested(now)).toBe(true);
    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBeNull();
    expect(await consumeRecoveryRequested(now)).toBe(false);
  });

  it('is ignored at an hour or older, and still removed', async () => {
    await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(1_700_000_000 - 3600));
    expect(await consumeRecoveryRequested(now)).toBe(false);
    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBeNull();
  });

  it('is false with no marker or an unreadable one', async () => {
    expect(await consumeRecoveryRequested(now)).toBe(false);
    await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, 'yesterday');
    expect(await consumeRecoveryRequested(now)).toBe(false);
    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).toBeNull();
  });
});

describe('an auth link', () => {
  it('reads the query and the fragment, the fragment winning', () => {
    expect(
      authLinkParams('lifepass://auth/callback?type=recovery&x=1#access_token=a%2Bb&refresh_token=r&x=2&type=recovery'),
    ).toEqual({ type: 'recovery', x: '2', access_token: 'a+b', refresh_token: 'r' });
    expect(authLinkParams('https://www.lifepass.is/app/auth-callback?code=abc')).toEqual({ code: 'abc' });
    expect(authLinkParams('lifepass://auth/callback')).toEqual({});
  });

  it('with tokens becomes the session they name', async () => {
    const session = sessionJSON(MEMBER, 3600);
    authHost.on('GET', '/auth/v1/user', Reply.json(200, session.user));
    const exchanged = await exchangeAuthLink(
      `lifepass://auth/callback#access_token=${session.access_token}&refresh_token=${session.refresh_token}&type=signup`,
    );
    expect(exchanged.session.user.id).toBe(MEMBER);
    expect(exchanged.recovery).toBe(false);
  });

  it('with a PKCE code is exchanged for a session', async () => {
    authHost.on('POST', '/auth/v1/token', Reply.json(200, sessionJSON(MEMBER, 3600)));
    const exchanged = await exchangeAuthLink('lifepass://auth/callback?code=the-code');
    expect(exchanged.session.user.id).toBe(MEMBER);
    const sent = authHost.sent('/auth/v1/token', 'POST');
    expect(sent.query.grant_type).toBe('pkce');
    expect((sent.body as { auth_code: string }).auth_code).toBe('the-code');
  });

  it('that says it failed is refused without asking the server', async () => {
    await expect(
      exchangeAuthLink('lifepass://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'),
    ).rejects.toBeInstanceOf(AuthLinkError);
    expect(authHost.requests).toHaveLength(0);
  });

  it('with neither tokens nor a code is refused', async () => {
    await expect(exchangeAuthLink('lifepass://auth/callback?type=signup')).rejects.toBeInstanceOf(AuthLinkError);
  });

  it('whose tokens the server refuses throws', async () => {
    const session = sessionJSON(MEMBER, 3600);
    authHost.on('GET', '/auth/v1/user', Reply.json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
    await expect(
      exchangeAuthLink(`lifepass://auth/callback#access_token=${session.access_token}&refresh_token=r`),
    ).rejects.toThrow();
  });
});

describe('updatePassword', () => {
  it('changes the password of the session the reset link opened', async () => {
    const session = sessionJSON(MEMBER, 3600);
    authHost.on('GET', '/auth/v1/user', Reply.json(200, session.user));
    authHost.on('PUT', '/auth/v1/user', Reply.json(200, session.user));
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });

    await updatePassword('a brand new password');

    expect((authHost.sent('/auth/v1/user', 'PUT').body as { password: string }).password).toBe('a brand new password');
  });
});
