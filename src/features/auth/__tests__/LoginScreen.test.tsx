/**
 * Log in (iOS LoginView + AuthViewModel.signIn): the checks and Supabase's
 * refusals in the screen's language, "Signing in…" while it runs, the
 * signed-in member, the email and provider sign-ins blocking each other
 * (iOS's one `isLoading`), the failed-link banner, and Forgot password's sheet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setEnv } from '@test/harness';
import { api, Reply, supabase as authHost, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { lookup, type Lang } from '../../../i18n';
import {
  freshStorePerTest,
  MEMBER_A,
  phoneLanguage,
  PLUS_SUBSCRIPTION,
  profileJSON,
  sessionJSON,
  settle,
} from '../../../stores/__tests__/storeHarness';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../supabase/lib/client';
import { RECOVERY_REQUESTED_AT_KEY } from '../../../supabase/services/auth';
import { resetSocialProviderSettingsForTests } from '../providerSettings';
import { signInWithSocialProvider, useSocialSignInStore } from '../social';
import { authNavigation, currentAuthRoute, renderAuth } from './authHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// The provider flow itself (Custom Tab, exchange) is socialSignIn.test.ts's; here only whether it starts.
jest.mock('../social', () => ({
  ...jest.requireActual('../social'),
  signInWithSocialProvider: jest.fn(),
}));

const startSocial = jest.mocked(signInWithSocialProvider);

stubApiClientPerTest();
freshStorePerTest();

beforeEach(() => bottomSheetMock.reset());

afterEach(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

const en = (key: string) => lookup(key, 'en');

async function openLogin(lang: Lang = 'en') {
  phoneLanguage(lang);
  resetAppStoreForTests();
  useAppStore.setState({ isLoading: false });
  await renderAuth();
  await act(async () => {
    authNavigation.navigate('Login');
  });
}

const emailField = () => screen.getByTestId('auth.login.email');
const passwordField = () => screen.getByTestId('auth.login.password');
const signInButton = () => screen.getByTestId('auth.login.submit');

async function signInWith(email: string, password: string) {
  await fireEvent.changeText(emailField(), email);
  await fireEvent.changeText(passwordField(), password);
  await fireEvent.press(signInButton());
}

function refuse(code: string, msg: string): StubReply {
  return Reply.json(400, { code: 400, error_code: code, msg });
}

describe('the checks before the request, in the screen language', () => {
  it.each<Lang>(['en', 'is'])('%s: both fields first, then the email', async (lang) => {
    await openLogin(lang);
    expect(screen.getByText(lookup('auth.tagline', lang))).toBeOnTheScreen();

    await fireEvent.press(signInButton());
    expect(screen.getByText(lookup('auth.err.missing_credentials', lang))).toBeOnTheScreen();

    await signInWith('member', 'password');
    expect(screen.getByText(lookup('auth.err.invalid_email', lang))).toBeOnTheScreen();
    expect(authHost.requests).toHaveLength(0);
  });

  it('an Icelandic phone reads the iOS sentence (AccountLanguageTests)', async () => {
    await openLogin('is');
    await fireEvent.press(signInButton());
    expect(screen.getByText('Sláðu inn netfang og lykilorð.')).toBeOnTheScreen();
  });
});

describe('what Supabase refuses', () => {
  it('wrong credentials point at Forgot password', async () => {
    await openLogin();
    authHost.on('POST', '/auth/v1/token', refuse('invalid_credentials', 'Invalid login credentials'));
    await signInWith('member@example.is', 'wrong password');
    await waitFor(() => expect(screen.getByText(en('auth.err.bad_credentials'))).toBeOnTheScreen());
    expect(useAppStore.getState().isAuthenticated).toBe(false);
  });

  it('an unconfirmed email asks for the link to be tapped', async () => {
    await openLogin('is');
    authHost.on('POST', '/auth/v1/token', refuse('email_not_confirmed', 'Email not confirmed'));
    await signInWith('member@example.is', 'a password');
    await waitFor(() => expect(screen.getByText(lookup('auth.err.unconfirmed', 'is'))).toBeOnTheScreen());
  });
});

describe('a sign-in', () => {
  beforeEach(() => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
  });

  it('says "Signing in…" and takes no second press while it runs, then signs the member in', async () => {
    await openLogin();
    let answer: (reply: StubReply) => void = () => undefined;
    authHost.on('POST', '/auth/v1/token', () => new Promise<StubReply>((resolve) => (answer = resolve)));

    await signInWith('  member@example.is ', 'the password');
    await waitFor(() => expect(screen.getByRole('button', { name: en('auth.signing_in') })).toBeDisabled());
    await fireEvent.press(signInButton());

    await act(async () => {
      answer(Reply.json(200, sessionJSON(MEMBER_A, 3600)));
      await settle();
    });
    await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
    expect(useAppStore.getState().userId).toBe(MEMBER_A);

    const sent = authHost.sentAll('/auth/v1/token', 'POST');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.query.grant_type).toBe('password');
    expect(sent[0]!.body).toMatchObject({ email: 'member@example.is', password: 'the password' });
  });
});

describe('one sign-in at a time (iOS: one isLoading for the screen)', () => {
  beforeEach(() => {
    resetSocialProviderSettingsForTests();
    useSocialSignInStore.setState({ busy: false, unreportedFailure: false });
    startSocial.mockReset().mockResolvedValue('cancelled');
    setEnv({ EXPO_PUBLIC_SOCIAL_SIGN_IN: 'YES' });
    authHost.on('GET', '/auth/v1/settings', Reply.json(200, { external: { email: true, apple: true, google: true } }));
  });

  it('while the email sign-in runs, Apple and Google are disabled and dimmed', async () => {
    await openLogin();
    await screen.findByTestId('auth.google');
    let answer: (reply: StubReply) => void = () => undefined;
    authHost.on('POST', '/auth/v1/token', () => new Promise<StubReply>((resolve) => (answer = resolve)));

    await signInWith('member@example.is', 'the password');
    await waitFor(() => expect(screen.getByTestId('auth.social')).toHaveStyle({ opacity: 0.6 }));
    for (const id of ['auth.apple', 'auth.google']) {
      expect(screen.getByTestId(id)).toHaveProp('accessibilityState', { disabled: true, busy: false });
    }
    await fireEvent.press(screen.getByTestId('auth.google'));
    expect(startSocial).not.toHaveBeenCalled();

    await act(async () => {
      answer(refuse('invalid_credentials', 'Invalid login credentials'));
      await settle();
    });
    await waitFor(() =>
      expect(screen.getByTestId('auth.google')).toHaveProp('accessibilityState', { disabled: false, busy: false }),
    );
    await fireEvent.press(screen.getByTestId('auth.google'));
    expect(startSocial).toHaveBeenCalledWith('google');
  });

  it('while a provider sign-in runs, Sign in says "Signing in…" and takes no press or keyboard Go', async () => {
    await openLogin();
    await screen.findByTestId('auth.google');
    await fireEvent.changeText(emailField(), 'member@example.is');
    await fireEvent.changeText(passwordField(), 'the password');

    await act(() => useSocialSignInStore.setState({ busy: true }));
    expect(screen.getByRole('button', { name: en('auth.signing_in') })).toBeDisabled();
    await fireEvent.press(signInButton());
    await fireEvent(passwordField(), 'submitEditing');
    await act(async () => settle());
    expect(authHost.sentAll('/auth/v1/token', 'POST')).toHaveLength(0);

    await act(() => useSocialSignInStore.setState({ busy: false }));
    expect(screen.getByRole('button', { name: en('auth.signin') })).toBeEnabled();
  });
});

describe('the banner for a failed auth link', () => {
  const message = en('auth.deeplink_err_confirm');

  it('shows, and clears once the member edits the email', async () => {
    await openLogin();
    await act(async () => useAppStore.getState().setDeepLinkError(message));
    expect(screen.getByText(message)).toBeOnTheScreen();
    await fireEvent.changeText(emailField(), 'm');
    expect(screen.queryByText(message)).toBeNull();
    expect(useAppStore.getState().deepLinkError).toBeNull();
  });

  it('closes on its button', async () => {
    await openLogin();
    await act(async () => useAppStore.getState().setDeepLinkError(message));
    await fireEvent.press(screen.getByRole('button', { name: en('common.close') }));
    expect(screen.queryByText(message)).toBeNull();
  });
});

describe('Forgot password?', () => {
  it('opens a sheet seeded with the typed email; an empty email is refused there', async () => {
    await openLogin();
    await fireEvent.changeText(emailField(), 'member@example.is');
    await fireEvent.press(screen.getByRole('button', { name: en('auth.forgot') }));

    expect(screen.getByRole('header', { name: en('auth.reset_title') })).toBeOnTheScreen();
    expect(screen.getByTestId('auth.resetSheet.email')).toHaveDisplayValue('member@example.is');

    await fireEvent.changeText(screen.getByTestId('auth.resetSheet.email'), '');
    await fireEvent.press(screen.getByTestId('auth.resetSheet.send'));
    expect(screen.getByText(en('auth.err.missing_email'))).toBeOnTheScreen();
    expect(authHost.requests).toHaveLength(0);
  });

  it('sends the reset link, marks the phone, says Email Sent, and OK closes it', async () => {
    await openLogin();
    authHost.on('POST', '/auth/v1/recover', Reply.json(200, {}));
    await fireEvent.changeText(emailField(), 'member@example.is');
    await fireEvent.press(screen.getByRole('button', { name: en('auth.forgot') }));
    await fireEvent.press(screen.getByTestId('auth.resetSheet.send'));

    await waitFor(() => expect(screen.getByText(en('auth.email_sent_body'))).toBeOnTheScreen());
    expect(authHost.sent('/auth/v1/recover', 'POST').query.redirect_to).toBe('lifepass://auth/callback?type=recovery');
    expect(await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY)).not.toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: en('common.ok') }));
    await waitFor(() => expect(screen.queryByRole('header', { name: en('auth.reset_title') })).toBeNull());
  });

  it('Cancel closes it', async () => {
    await openLogin();
    await fireEvent.press(screen.getByRole('button', { name: en('auth.forgot') }));
    await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('header', { name: en('auth.reset_title') })).toBeNull());
  });
});

it('"Sign up" opens the sign-up screen', async () => {
  await openLogin();
  await fireEvent.press(screen.getByRole('button', { name: en('auth.signup') }));
  expect(currentAuthRoute()).toBe('SignUp');
});
