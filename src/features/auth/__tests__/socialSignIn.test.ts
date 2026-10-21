/**
 * Continue with Google / Apple, end to end through the app's real Supabase
 * client and app store against the stub auth server and API: the page, the
 * code exchange, the metadata, and the ORDER that matters (the missing
 * metadata reaches the account before the first `GET /profile`, because the
 * API creates the profile once from it), plus iOS's "a cancel is silent".
 */
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { api, Reply, supabase as authHost, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_URL } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import {
  freshStorePerTest,
  MEMBER_A,
  PLUS_SUBSCRIPTION,
  profileJSON,
  sessionJSON,
  settle,
} from '../../../stores/__tests__/storeHarness';
import { handleDeepLink, resetDeepLinksForTests, startDeepLinks } from '../../../app/deepLinks';
import { handleAuthCallback } from '../authCallback';
import {
  completeSocialReturn,
  isProviderCancel,
  isSocialReturnUrl,
  loadPendingSocialAttempt,
  parseSocialReturn,
  resetSocialSignInForTests,
  resumeSocialSignIn,
  setSocialTimingForTests,
  signInWithSocialProvider,
  SOCIAL_ATTEMPT_MAX_AGE_MS,
  SOCIAL_PAGE_OPTIONS,
  SOCIAL_PENDING_KEY,
  SOCIAL_RETURN_URL,
  SOCIAL_TIMING_DEFAULTS,
  socialAuthorizeUrl,
  takeUnreportedSocialFailure,
  useSocialSignInStore,
} from '../social';
import { codeChallenge } from '../socialPkce';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// The email-link handler (AUTH-1): a social return must never reach it.
jest.mock('../authCallback', () => ({ handleAuthCallback: jest.fn(async () => undefined) }));

stubApiClientPerTest();
freshStorePerTest();

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
/** The tab closed with no link (the mock module has no enum to name these with). */
const CANCELLED = { type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult;
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;
const store = () => useAppStore.getState();

type UrlHandler = (event: { url: string }) => void;
let urlHandlers: UrlHandler[] = [];

/** What the server and the API saw, in order, across both hosts. */
let order: string[] = [];

beforeEach(() => {
  resetSocialSignInForTests();
  resetDeepLinksForTests();
  jest.mocked(handleAuthCallback).mockClear();
  setSocialTimingForTests({ metadataRetryDelayMs: 0, lateReturnGraceMs: 0 });
  order = [];
  urlHandlers = [];
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: UrlHandler) => {
    urlHandlers.push(handler);
    return {
      remove: () => {
        urlHandlers = urlHandlers.filter((h) => h !== handler);
      },
    };
  }) as never);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
});

afterEach(() => {
  resetSocialSignInForTests();
  jest.restoreAllMocks();
  openAuthSession.mockReset();
});

/** The `redirect_to` the page was given (the return link with its attempt). */
function redirectOf(authorizeUrl: string): string {
  const match = /[?&]redirect_to=([^&]*)/.exec(authorizeUrl);
  if (!match) throw new Error(`no redirect_to in ${authorizeUrl}`);
  return decodeURIComponent(match[1]!);
}

function queryOf(url: string): Record<string, string> {
  const query = url.slice(url.indexOf('?') + 1);
  return Object.fromEntries(
    query.split('&').map((pair) => {
      const at = pair.indexOf('=');
      return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))];
    }),
  );
}

/** The page comes back with a code (or whatever `suffix` says) on the link it was given. */
function pageReturns(suffix = 'code=auth-code-1') {
  openAuthSession.mockImplementation(async (url: string) => ({ type: 'success', url: `${redirectOf(url)}&${suffix}` }));
}

/** The member's account as the token grant returns it. */
function serveAuthServer(options: { metadata?: Record<string, unknown>; userId?: string } = {}) {
  const userId = options.userId ?? MEMBER_A;
  const session = sessionJSON(userId, 3600, 'refresh-social');
  const user = {
    ...session.user,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: options.metadata ?? { full_name: 'Anna Jónsdóttir', email: 'anna@gmail.com' },
  };
  authHost.on('POST', '/auth/v1/token', (request) => {
    order.push(`token:${request.query.grant_type}`);
    return Reply.json(200, { ...session, user });
  });
  authHost.on('PUT', '/auth/v1/user', (request) => {
    order.push('metadata');
    return Reply.json(200, { ...user, user_metadata: { ...user.user_metadata, ...(request.body as { data: object }).data } });
  });
  authHost.on('GET', '/auth/v1/user', () => {
    order.push('user');
    return Reply.json(200, user);
  });
  return { session, user };
}

function serveMember() {
  api.on('GET', '/profile', () => {
    order.push('profile');
    return Reply.ok(profileJSON({ kennitalaVerified: true }));
  });
  api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
}

describe('the page', () => {
  it('opens Supabase’s Google page in PKCE mode, asking Google to let the member pick an account', async () => {
    serveAuthServer();
    serveMember();
    let saved: Awaited<ReturnType<typeof loadPendingSocialAttempt>> = null;
    openAuthSession.mockImplementation(async (url: string) => {
      saved = await loadPendingSocialAttempt();
      return CANCELLED;
    });
    await signInWithSocialProvider('google');

    expect(openAuthSession).toHaveBeenCalledTimes(1);
    const [url, returnUrl, options] = openAuthSession.mock.calls[0]!;
    expect(url.startsWith(`${TEST_SUPABASE_URL}/auth/v1/authorize?`)).toBe(true);
    const query = queryOf(url);
    expect(query.provider).toBe('google');
    expect(query.prompt).toBe('select_account');
    expect(query.code_challenge_method).toBe('s256');
    // The verifier saved before the page opened is the one the challenge was made of.
    expect(saved).not.toBeNull();
    expect(saved!.provider).toBe('google');
    expect(query.code_challenge).toBe(codeChallenge(saved!.verifier));
    expect(query.redirect_to).toBe(`lifepass://auth/callback/social?attempt=${saved!.attempt}`);
    // Waits on the return link's prefix, in the app's own task.
    expect(returnUrl).toBe(SOCIAL_RETURN_URL);
    expect(options).toBe(SOCIAL_PAGE_OPTIONS);
    expect(SOCIAL_PAGE_OPTIONS.createTask).toBe(false);
  });

  it('opens Apple through the same web page, without Google’s prompt', () => {
    const url = socialAuthorizeUrl('apple', 'challenge-1', 'attempt-1');
    const query = queryOf(url);
    expect(query.provider).toBe('apple');
    expect(query.prompt).toBeUndefined();
    expect(query.code_challenge).toBe('challenge-1');
    expect(query.redirect_to).toBe('lifepass://auth/callback/social?attempt=attempt-1');
  });

  it('returns under the redirect allow-list entry lifepass://auth/callback**', () => {
    expect(SOCIAL_RETURN_URL.startsWith('lifepass://auth/callback')).toBe(true);
  });
});

describe('a sign-in', () => {
  it('exchanges the code with the saved verifier, writes the missing metadata, THEN signs in and reads the profile', async () => {
    await store().bootstrap();
    const { session } = serveAuthServer();
    serveMember();
    let verifier = '';
    openAuthSession.mockImplementation(async (url: string) => {
      verifier = (await loadPendingSocialAttempt())!.verifier;
      return { type: 'success', url: `${redirectOf(url)}&code=auth-code-1` };
    });

    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    await settle(10);

    // The grant: the one-time code and this phone's verifier, with the publishable key.
    const grant = authHost.sent('/auth/v1/token', 'POST');
    expect(grant.query.grant_type).toBe('pkce');
    expect(grant.body).toEqual({ auth_code: 'auth-code-1', code_verifier: verifier });
    expect(grant.headers.apikey).toBe(TEST_SUPABASE_ANON_KEY);

    // Only what the account lacks, as the member, with the screens' language.
    const metadata = authHost.sent('/auth/v1/user', 'PUT');
    expect(metadata.body).toEqual({ data: { locale: 'en', signup_source: 'android', marketing_opt_in: false } });
    expect(metadata.headers.authorization).toBe(`Bearer ${session.access_token}`);
    expect(metadata.headers.apikey).toBe(TEST_SUPABASE_ANON_KEY);

    // THE ORDER: the metadata before the session reaches the app, and before any profile read.
    expect(order.indexOf('metadata')).toBeGreaterThan(order.indexOf('token:pkce'));
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('user'));
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('profile'));
    expect(api.sentAll('/profile', 'GET')).toHaveLength(1);

    expect(store().isAuthenticated).toBe(true);
    expect(store().userId).toBe(MEMBER_A);
    expect(store().session?.access_token).toBe(session.access_token);
    // The verifier is spent.
    expect(await loadPendingSocialAttempt()).toBeNull();
    expect(useSocialSignInStore.getState().busy).toBe(false);
  });

  it('nothing is signed in, and no profile read, until the metadata write is answered', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    pageReturns();
    let answer!: () => void;
    authHost.on(
      'PUT',
      '/auth/v1/user',
      () =>
        new Promise((resolve) => {
          answer = () => resolve(Reply.json(200, {}));
        }),
    );
    const signIn = signInWithSocialProvider('google');
    for (let i = 0; i < 20 && !answer; i += 1) await settle(1);
    await settle(5);
    expect(store().isAuthenticated).toBe(false);
    expect(api.sentAll('/profile')).toHaveLength(0);
    expect(useSocialSignInStore.getState().busy).toBe(true);
    answer();
    await expect(signIn).resolves.toBe('signedIn');
    expect(store().isAuthenticated).toBe(true);
  });

  it('writes the language the screens speak (Icelandic)', async () => {
    await store().bootstrap();
    setCurrentLanguage('is');
    serveAuthServer({ metadata: { full_name: 'Jón Jónsson' } });
    serveMember();
    pageReturns();
    await signInWithSocialProvider('google');
    expect(authHost.sent('/auth/v1/user', 'PUT').body).toEqual({
      data: { locale: 'is', signup_source: 'android', marketing_opt_in: false },
    });
  });

  it('an existing account linked by email (nothing missing) gets no write at all', async () => {
    await store().bootstrap();
    serveAuthServer({
      metadata: { full_name: 'Anna J.', locale: 'is', signup_source: 'ios', marketing_opt_in: true },
    });
    serveMember();
    pageReturns();
    await expect(signInWithSocialProvider('apple')).resolves.toBe('signedIn');
    expect(authHost.sentAll('/auth/v1/user', 'PUT')).toHaveLength(0);
    expect(store().isAuthenticated).toBe(true);
  });

  it('a failed metadata write is tried once more, after the pause', async () => {
    expect(SOCIAL_TIMING_DEFAULTS.metadataRetryDelayMs).toBe(800);
    setSocialTimingForTests({ metadataRetryDelayMs: 40, lateReturnGraceMs: 0 });
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    pageReturns();
    const startedAt = Date.now();
    authHost.once('PUT', '/auth/v1/user', () => {
      order.push('metadata-failed');
      return Reply.json(500, { code: 500, msg: 'boom' });
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    expect(authHost.sentAll('/auth/v1/user', 'PUT')).toHaveLength(2);
    // The pause came between the two tries.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(order.indexOf('metadata')).toBeGreaterThan(order.indexOf('metadata-failed'));
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('profile'));
  });

  it('a metadata write that fails twice still signs the member in (as iOS)', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    pageReturns();
    authHost.on('PUT', '/auth/v1/user', Reply.fail());
    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    expect(authHost.sentAll('/auth/v1/user', 'PUT')).toHaveLength(2);
    expect(store().isAuthenticated).toBe(true);
  });

  it('a second tap while one runs does nothing', async () => {
    serveAuthServer();
    serveMember();
    let close!: () => void;
    openAuthSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          close = () => resolve(DISMISSED);
        }),
    );
    const first = signInWithSocialProvider('google');
    await settle(2);
    await expect(signInWithSocialProvider('apple')).resolves.toBe('busy');
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    close();
    await expect(first).resolves.toBe('cancelled');
  });
});

describe('a cancel is silent', () => {
  it.each(['cancel', 'dismiss'] as const)('the page closed with no link (%s)', async (type) => {
    openAuthSession.mockResolvedValue({ type } as WebBrowser.WebBrowserAuthSessionResult);
    await expect(signInWithSocialProvider('google')).resolves.toBe('cancelled');
    expect(authHost.requests).toHaveLength(0);
    expect(await loadPendingSocialAttempt()).toBeNull();
    expect(useSocialSignInStore.getState().busy).toBe(false);
  });

  it.each([
    'error=user_cancelled_authorize',
    'error=access_denied&error_description=The+user+denied',
    'error=invalid_request&error_code=access_denied',
  ])('the member pressed Cancel on Apple’s page, the twin of iOS’s native Apple sheet (%s)', async (suffix) => {
    pageReturns(suffix);
    await expect(signInWithSocialProvider('apple')).resolves.toBe('cancelled');
    expect(authHost.requests).toHaveLength(0);
  });
});

describe('anything else fails (auth.social_failed)', () => {
  it('Cancel on Google’s own consent page: iOS gets it as an error in the link and says it failed', async () => {
    pageReturns('error=access_denied&error_description=The+user+denied+the+request');
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(authHost.requests).toHaveLength(0);
    expect(await loadPendingSocialAttempt()).toBeNull();
  });

  it('the provider or the server sent an error', async () => {
    pageReturns('error=server_error&error_description=Unable+to+exchange+external+code');
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(authHost.requests).toHaveLength(0);
  });

  it('the page came back with no code', async () => {
    openAuthSession.mockImplementation(async (url: string) => ({ type: 'success', url: redirectOf(url) }));
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
  });

  it('the code exchange is refused', async () => {
    pageReturns();
    authHost.on('POST', '/auth/v1/token', Reply.json(400, { code: 400, error_code: 'flow_state_expired', msg: 'expired' }));
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(authHost.sentAll('/auth/v1/user')).toHaveLength(0);
    expect(store().isAuthenticated).toBe(false);
  });

  it('the exchange is unreachable', async () => {
    pageReturns();
    authHost.on('POST', '/auth/v1/token', Reply.fail());
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
  });

  it('the session cannot be stored', async () => {
    serveAuthServer();
    pageReturns();
    authHost.on('GET', '/auth/v1/user', Reply.json(500, { code: 500, msg: 'boom' }));
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(store().isAuthenticated).toBe(false);
  });

  it('the page never opened', async () => {
    openAuthSession.mockRejectedValue(new Error('WebBrowser is already open, only one can be open at a time'));
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(await loadPendingSocialAttempt()).toBeNull();
    expect(useSocialSignInStore.getState().busy).toBe(false);
  });
});

describe('the return link reaching the app another way', () => {
  it('a link that loses the race with the foreground still counts', async () => {
    setSocialTimingForTests({ metadataRetryDelayMs: 0, lateReturnGraceMs: 200 });
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    openAuthSession.mockImplementation(async (url: string) => {
      const link = `${redirectOf(url)}&code=auth-code-1`;
      setTimeout(() => urlHandlers.forEach((handler) => handler({ url: link })), 20);
      return DISMISSED;
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    expect(store().isAuthenticated).toBe(true);
  });

  it('after Android destroyed the screen behind the page but kept the process, the new screen’s launch link counts', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    openAuthSession.mockImplementation(async (url: string) => {
      // React Native hands a link that starts a new screen only to getInitialURL.
      jest.mocked(Linking.getInitialURL).mockResolvedValue(`${redirectOf(url)}&code=auth-code-1`);
      return DISMISSED;
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    expect(store().isAuthenticated).toBe(true);
  });

  it('an older launch link (another attempt) is not taken for this one', async () => {
    jest
      .mocked(Linking.getInitialURL)
      .mockResolvedValue('lifepass://auth/callback/social?attempt=an-old-one&code=old-code');
    openAuthSession.mockResolvedValue(DISMISSED);
    await expect(signInWithSocialProvider('google')).resolves.toBe('cancelled');
    expect(authHost.requests).toHaveLength(0);
  });

  it('through the deep-link router while the page is open: the page takes it', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    let routed: Promise<unknown> = Promise.resolve();
    openAuthSession.mockImplementation(async (url: string) => {
      routed = completeSocialReturn(`${redirectOf(url)}&code=auth-code-1`);
      return DISMISSED;
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('signedIn');
    await expect(routed).resolves.toBe('ignored');
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
  });

  it('after Android dropped the process behind the page, the start finishes the sign-in', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    // The attempt as the first process saved it before opening the page.
    let link = '';
    openAuthSession.mockImplementation(async (url: string) => {
      link = `${redirectOf(url)}&code=auth-code-1`;
      return new Promise(() => undefined); // the process dies with the page open
    });
    void signInWithSocialProvider('google');
    for (let i = 0; i < 20 && !link; i += 1) await settle(1);
    const saved = await loadPendingSocialAttempt();
    expect(saved).not.toBeNull();
    resetSocialSignInForTests(); // a new process: nothing in memory
    setSocialTimingForTests({ metadataRetryDelayMs: 0, lateReturnGraceMs: 0 });

    jest.mocked(Linking.getInitialURL).mockResolvedValue(link);
    await expect(resumeSocialSignIn()).resolves.toBe('signedIn');
    expect(authHost.sent('/auth/v1/token', 'POST').body).toEqual({
      auth_code: 'auth-code-1',
      code_verifier: saved!.verifier,
    });
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('profile'));
    expect(store().isAuthenticated).toBe(true);

    // The same link replayed (a relaunch from Recents) does nothing.
    resetSocialSignInForTests();
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
  });

  it('one link finishes one sign-in, however many ways it arrives', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    const link = 'lifepass://auth/callback/social?attempt=attempt-1&code=auth-code-1';
    jest.mocked(Linking.getInitialURL).mockResolvedValue(link);
    const [a, b] = await Promise.all([resumeSocialSignIn(), completeSocialReturn(link)]);
    expect(a).toBe('signedIn');
    expect(b).toBe('signedIn');
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
  });

  it('ignores another attempt’s link, a forged one, or one too old, without a request', async () => {
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    await expect(
      completeSocialReturn('lifepass://auth/callback/social?attempt=attempt-2&code=stolen'),
    ).resolves.toBe('ignored');
    await expect(completeSocialReturn('lifepass://auth/callback/social?code=no-attempt')).resolves.toBe('ignored');
    await expect(completeSocialReturn('lifepass://auth/callback?code=email-link')).resolves.toBe('ignored');
    expect(authHost.requests).toHaveLength(0);
    // Still waiting for its own link.
    expect((await loadPendingSocialAttempt())?.attempt).toBe('attempt-1');

    resetSocialSignInForTests();
    await saveAttempt({ attempt: 'attempt-3', startedAt: Date.now() - SOCIAL_ATTEMPT_MAX_AGE_MS - 1 });
    await expect(
      completeSocialReturn('lifepass://auth/callback/social?attempt=attempt-3&code=late'),
    ).resolves.toBe('ignored');
    expect(authHost.requests).toHaveLength(0);
    expect(await loadPendingSocialAttempt()).toBeNull();
  });

  it('reports a launch link’s attempt once, however often a sign-in screen appears', async () => {
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    authHost.on('POST', '/auth/v1/token', Reply.json(400, { code: 400, error_code: 'bad_code_verifier', msg: 'x' }));
    jest
      .mocked(Linking.getInitialURL)
      .mockResolvedValue('lifepass://auth/callback/social?attempt=attempt-1&code=auth-code-1');
    await expect(resumeSocialSignIn()).resolves.toBe('failed');
    // Log in again after a sign-out, in the same process: the launch link is the same, and old.
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
    // The failure waits for one screen to show it, once.
    expect(takeUnreportedSocialFailure()).toBe(true);
    expect(takeUnreportedSocialFailure()).toBe(false);
  });

  it('a settled attempt is not handed to later callers: the router finished it, a screen’s resume gets nothing', async () => {
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    authHost.on('POST', '/auth/v1/token', Reply.json(400, { code: 400, error_code: 'flow_state_expired', msg: 'x' }));
    const link = 'lifepass://auth/callback/social?attempt=attempt-1&code=auth-code-1';
    jest.mocked(Linking.getInitialURL).mockResolvedValue(link);
    await expect(completeSocialReturn(link)).resolves.toBe('failed');
    expect(useSocialSignInStore.getState().unreportedFailure).toBe(true);
    expect(takeUnreportedSocialFailure()).toBe(true);

    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    await expect(completeSocialReturn(link)).resolves.toBe('ignored');
    expect(useSocialSignInStore.getState().unreportedFailure).toBe(false);
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
  });

  it('a page sign-in that fails tells its own button, not the next screen', async () => {
    pageReturns('error=server_error');
    await expect(signInWithSocialProvider('google')).resolves.toBe('failed');
    expect(useSocialSignInStore.getState().unreportedFailure).toBe(false);
  });

  it('a start that was not the page’s return does nothing', async () => {
    jest.mocked(Linking.getInitialURL).mockResolvedValue('lifepass://scan?v=3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    jest.mocked(Linking.getInitialURL).mockResolvedValue(null);
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    jest.mocked(Linking.getInitialURL).mockRejectedValue(new Error('no activity'));
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
  });
});

describe('through the deep-link router (src/app/deepLinks.ts)', () => {
  const LINK = 'lifepass://auth/callback/social?attempt=attempt-1&code=auth-code-1';

  it('a return with a code finishes the sign-in and never reaches the email-link handler', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    expect(handleDeepLink(LINK).kind).toBe('auth');
    await waitUntil(() => store().isAuthenticated);
    expect(handleAuthCallback).not.toHaveBeenCalled();
    expect(store().deepLinkError).toBeNull();
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('profile'));
  });

  it('a provider error or Cancel return sets no banner and makes no request', async () => {
    for (const [provider, query] of [
      ['apple', 'error=user_cancelled_authorize'],
      ['google', 'error=access_denied&error_description=The+user+denied'],
    ] as const) {
      await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now(), provider });
      handleDeepLink(`lifepass://auth/callback/social?attempt=attempt-1&${query}`);
      await waitUntil(async () => (await loadPendingSocialAttempt()) === null);
      await settle(2);
    }
    expect(handleAuthCallback).not.toHaveBeenCalled();
    expect(store().deepLinkError).toBeNull();
    expect(authHost.requests).toHaveLength(0);
    // Apple's Cancel says nothing; Google's failure waits for the sign-in screen.
    expect(takeUnreportedSocialFailure()).toBe(true);
    expect(takeUnreportedSocialFailure()).toBe(false);
  });

  it('a stray social link does nothing at all', async () => {
    handleDeepLink('lifepass://auth/callback/social?attempt=nobody&code=stolen');
    await settle(5);
    expect(handleAuthCallback).not.toHaveBeenCalled();
    expect(store().deepLinkError).toBeNull();
    expect(authHost.requests).toHaveLength(0);
  });

  it('an email link still goes to the email-link handler', () => {
    handleDeepLink('lifepass://auth/callback?code=email-code');
    handleDeepLink('lifepass://auth/callback#access_token=a&refresh_token=b');
    expect(handleAuthCallback).toHaveBeenCalledTimes(2);
  });

  it('a start by the return link (process death behind the page) finishes the sign-in at once, no screen needed', async () => {
    await store().bootstrap();
    serveAuthServer();
    serveMember();
    await saveAttempt({ attempt: 'attempt-1', startedAt: Date.now() });
    jest.mocked(Linking.getInitialURL).mockResolvedValue(LINK);
    const stop = startDeepLinks();
    await waitUntil(() => store().isAuthenticated);
    stop();
    expect(store().userId).toBe(MEMBER_A);
    expect(handleAuthCallback).not.toHaveBeenCalled();
    expect(store().deepLinkError).toBeNull();
    expect(await loadPendingSocialAttempt()).toBeNull();
    // A sign-in screen's fallback finds nothing left to do.
    await expect(resumeSocialSignIn()).resolves.toBe('ignored');
    expect(authHost.sentAll('/auth/v1/token')).toHaveLength(1);
  });
});

describe('a member signed in another way meanwhile', () => {
  it('while the page was open (the email form finished): the return is dropped, silently, before the exchange', async () => {
    openAuthSession.mockImplementation(async (url: string) => {
      useAppStore.setState({ isAuthenticated: true, userId: 'member-by-email' });
      return { type: 'success', url: `${redirectOf(url)}&code=auth-code-1` };
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('cancelled');
    expect(authHost.requests).toHaveLength(0);
    expect(store().userId).toBe('member-by-email');
  });

  it('while the metadata was written: the session is never handed over', async () => {
    serveAuthServer();
    serveMember();
    pageReturns();
    authHost.on('PUT', '/auth/v1/user', () => {
      order.push('metadata');
      useAppStore.setState({ isAuthenticated: true, userId: 'member-by-email' });
      return Reply.json(200, {});
    });
    await expect(signInWithSocialProvider('google')).resolves.toBe('cancelled');
    expect(order).toEqual(['token:pkce', 'metadata']);
    expect(store().userId).toBe('member-by-email');
    expect(useSocialSignInStore.getState().unreportedFailure).toBe(false);
  });
});

describe('the return link', () => {
  it('is told apart from the email links', () => {
    expect(isSocialReturnUrl('lifepass://auth/callback/social?attempt=a&code=c')).toBe(true);
    expect(isSocialReturnUrl('LIFEPASS://auth/callback/social?attempt=a')).toBe(true);
    expect(isSocialReturnUrl('lifepass://auth/callback/social#error=access_denied')).toBe(true);
    expect(isSocialReturnUrl('lifepass://auth/callback/social')).toBe(true);
    for (const other of [
      'lifepass://auth/callback',
      'lifepass://auth/callback?code=c',
      'lifepass://auth/callback#access_token=a&refresh_token=b',
      'lifepass://auth/callback?type=recovery',
      'https://www.lifepass.is/app/auth-callback?code=c',
      'lifepass://auth/callback/socialite',
      '',
      null,
      undefined,
    ]) {
      expect(isSocialReturnUrl(other)).toBe(false);
    }
  });

  it('reads the code or an error, from the query or the fragment', () => {
    expect(parseSocialReturn('lifepass://auth/callback/social?attempt=a1&code=c1')).toEqual({
      kind: 'code',
      attempt: 'a1',
      code: 'c1',
    });
    expect(parseSocialReturn('lifepass://auth/callback/social?attempt=a1#error=access_denied')).toEqual({
      kind: 'error',
      attempt: 'a1',
      error: 'access_denied',
      codes: ['access_denied'],
    });
    expect(
      parseSocialReturn('lifepass://auth/callback/social?attempt=a1&error=server_error&error_description=x+y'),
    ).toEqual({ kind: 'error', attempt: 'a1', error: 'server_error', codes: ['server_error'] });
    expect(
      parseSocialReturn('lifepass://auth/callback/social?attempt=a1&error=Invalid_Request&error_code=ACCESS_DENIED'),
    ).toEqual({ kind: 'error', attempt: 'a1', error: 'Invalid_Request', codes: ['invalid_request', 'access_denied'] });
    expect(parseSocialReturn('lifepass://auth/callback/social?attempt=a%2F1')).toEqual({
      kind: 'error',
      attempt: 'a/1',
      error: 'no_code',
      codes: ['no_code'],
    });
    expect(parseSocialReturn('lifepass://auth/callback?code=c')).toBeNull();
  });

  it('a Cancel is silent on Apple’s page only', () => {
    const said = (query: string) => parseSocialReturn(`lifepass://auth/callback/social?attempt=a1&${query}`)!;
    expect(isProviderCancel('apple', said('error=user_cancelled_authorize'))).toBe(true);
    expect(isProviderCancel('apple', said('error=access_denied'))).toBe(true);
    expect(isProviderCancel('apple', said('error=server_error'))).toBe(false);
    expect(isProviderCancel('apple', said('code=c1'))).toBe(false);
    expect(isProviderCancel('google', said('error=access_denied'))).toBe(false);
    expect(isProviderCancel('google', said('error=user_cancelled_authorize'))).toBe(false);
  });
});

async function saveAttempt(values: {
  attempt: string;
  startedAt: number;
  provider?: 'google' | 'apple';
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  await SecureStore.setItemAsync(
    SOCIAL_PENDING_KEY,
    JSON.stringify({ provider: 'google', ...values, verifier: 'verifier-'.padEnd(43, 'x') }),
  );
}

/** Lets the stub servers and the store work until `done` holds (or fails the test after a while). */
async function waitUntil(done: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (await done()) return;
    await settle(1);
  }
  throw new Error('waitUntil: never happened');
}
