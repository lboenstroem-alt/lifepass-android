/**
 * Create account (iOS SignUpView + AuthViewModel.signUp): Create refused
 * until Terms is ticked, the checks in iOS order and the screen's language,
 * the nationality prefilled from the email, exactly iOS's metadata with
 * `signup_source: 'android'`, the check-your-email alert, and its Android
 * fallback.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

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
} from '../../../stores/__tests__/storeHarness';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../supabase/lib/client';
import { authNavigation, authStack, renderAuth } from './authHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();
freshStorePerTest();

beforeEach(() => bottomSheetMock.reset());

afterEach(async () => {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
});

const en = (key: string) => lookup(key, 'en');

/** Sign up reached the way a new member reaches it: the splash's slides, then Skip (or from Log in). */
async function openSignUp(lang: Lang = 'en', from: 'onboarding' | 'login' = 'onboarding') {
  phoneLanguage(lang);
  resetAppStoreForTests();
  useAppStore.setState({ isLoading: false });
  await renderAuth();
  await act(async () => {
    if (from === 'login') authNavigation.navigate('Login');
    authNavigation.navigate('SignUp');
  });
}

const field = (name: 'name' | 'email' | 'password') => screen.getByTestId(`auth.signup.${name}`);
const createButton = () => screen.getByTestId('auth.signup.create');

async function fill(values: { name?: string; email?: string; password?: string }) {
  if (values.name !== undefined) await fireEvent.changeText(field('name'), values.name);
  if (values.email !== undefined) await fireEvent.changeText(field('email'), values.email);
  if (values.password !== undefined) await fireEvent.changeText(field('password'), values.password);
}

async function tickTerms() {
  await fireEvent.press(screen.getByTestId('auth.signup.terms'));
}

const NO_SESSION: StubReply = Reply.json(200, { id: MEMBER_A, email: 'member@example.is', aud: 'authenticated' });

describe('the Terms gate', () => {
  it('keeps Create refused until Terms is ticked', async () => {
    await openSignUp();
    expect(createButton()).toBeDisabled();
    expect(screen.getByRole('checkbox', { checked: false })).toBeOnTheScreen();
    await tickTerms();
    expect(createButton()).toBeEnabled();
    expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
    await tickTerms();
    expect(createButton()).toBeDisabled();
  });

  it('names its Terms and Privacy links, which open the website', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openSignUp();
    expect(screen.getByRole('checkbox', { name: 'I agree to the Terms and Privacy Policy.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(open.mock.calls.map(([url]) => url)).toEqual(['https://lifepass.is/terms', 'https://lifepass.is/privacy']);
    open.mockRestore();
  });

  it('starts with marketing off', async () => {
    await openSignUp();
    expect(screen.getByRole('switch', { name: en('auth.marketing_optin') })).not.toBeChecked();
  });
});

describe('the checks, in iOS order and the screen language', () => {
  it.each<Lang>(['en', 'is'])('%s', async (lang) => {
    await openSignUp(lang);
    await tickTerms();

    await fireEvent.press(createButton());
    expect(screen.getByText(lookup('auth.err.missing_fields', lang))).toBeOnTheScreen();

    await fill({ name: 'Jón Jónsson', email: 'member', password: 'short' });
    await fireEvent.press(createButton());
    expect(screen.getByText(lookup('auth.err.invalid_email', lang))).toBeOnTheScreen();

    await fill({ email: 'member@example.is' });
    await fireEvent.press(createButton());
    expect(screen.getByText(lookup('auth.err.password_short', lang))).toBeOnTheScreen();
    expect(authHost.requests).toHaveLength(0);
  });

  it('speaks Icelandic on an Icelandic phone after onboarding (AccountLanguageTests)', async () => {
    await openSignUp('is');
    expect(screen.getByRole('header', { name: 'Búa til aðgang' })).toBeOnTheScreen();
    expect(screen.getByPlaceholderText(lookup('auth.password_create', 'is'))).toBeOnTheScreen();
  });
});

describe('nationality', () => {
  it('is prefilled from the email domain until the member picks one', async () => {
    await openSignUp();
    const trigger = () => screen.getByTestId('auth.signup.nationality');
    expect(trigger()).toHaveTextContent(en('auth.nationality'), { exact: false });

    await fill({ email: 'member@example.is' });
    expect(trigger()).toHaveTextContent('Iceland', { exact: false });
    await fill({ email: 'member@example.co.uk' });
    expect(trigger()).toHaveTextContent('United Kingdom', { exact: false });
    await fill({ email: 'member@gmail.com' });
    expect(trigger()).toHaveTextContent(en('auth.nationality'), { exact: false });

    await fireEvent.press(trigger());
    await fireEvent.press(screen.getByTestId('auth.signup.nationality.DE'));
    expect(trigger()).toHaveTextContent('Germany', { exact: false });
    await fill({ email: 'member@example.is' });
    expect(trigger()).toHaveTextContent('Germany', { exact: false });
  });
});

describe('Create account', () => {
  async function createAs(email = 'member@example.is') {
    await fill({ name: '  Jón Jónsson ', email: ` ${email} `, password: 'a long password ' });
    await tickTerms();
    await fireEvent.press(createButton());
  }

  it('sends exactly the iOS metadata, from Android, in the language on screen', async () => {
    await openSignUp('is');
    authHost.on('POST', '/auth/v1/signup', NO_SESSION);
    await fireEvent.press(screen.getByRole('switch'));
    await createAs();

    await waitFor(() => expect(authHost.sentAll('/auth/v1/signup', 'POST')).toHaveLength(1));
    const sent = authHost.sent('/auth/v1/signup', 'POST');
    const body = sent.body as { email: string; password: string; data: Record<string, unknown> };
    expect(body.email).toBe('member@example.is');
    expect(body.password).toBe('a long password ');
    expect(body.data).toEqual({
      full_name: 'Jón Jónsson',
      marketing_opt_in: true,
      signup_source: 'android',
      locale: 'is',
      nationality: 'IS',
    });
    expect(sent.query.redirect_to).toBe('lifepass://auth/callback');
  });

  it('leaves nationality out when unset', async () => {
    await openSignUp();
    authHost.on('POST', '/auth/v1/signup', NO_SESSION);
    await createAs('member@gmail.com');
    await waitFor(() => expect(authHost.sentAll('/auth/v1/signup', 'POST')).toHaveLength(1));
    const data = (authHost.sent('/auth/v1/signup', 'POST').body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(['full_name', 'locale', 'marketing_opt_in', 'signup_source']);
    expect(data.marketing_opt_in).toBe(false);
    expect(data.locale).toBe('en');
  });

  it('with a confirmation to come: "Check your email", and OK goes to Log in in its place', async () => {
    await openSignUp();
    authHost.on('POST', '/auth/v1/signup', NO_SESSION);
    await createAs();

    await waitFor(() => expect(screen.getByText(en('auth.check_email'))).toBeOnTheScreen());
    expect(screen.getByText(lookup('auth.check_email_body', 'en').replace('{email}', 'member@example.is'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.ok') }));
    expect(authStack()).toEqual(['Onboarding', 'Login']);
  });

  it('from Log in, OK goes back to it', async () => {
    await openSignUp('en', 'login');
    authHost.on('POST', '/auth/v1/signup', NO_SESSION);
    await createAs();
    await waitFor(() => expect(screen.getByText(en('auth.check_email'))).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: en('common.ok') }));
    expect(authStack()).toEqual(['Onboarding', 'Login']);
  });

  it('the email rate limit has its own sentence', async () => {
    await openSignUp();
    authHost.on(
      'POST',
      '/auth/v1/signup',
      Reply.json(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }),
    );
    await createAs();
    await waitFor(() => expect(screen.getByText(en('auth.err.rate_limited'))).toBeOnTheScreen());
  });

  describe('signing in', () => {
    beforeEach(() => {
      api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
      api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    });

    it('at once when the project gives a session', async () => {
      await openSignUp();
      authHost.on('POST', '/auth/v1/signup', Reply.json(200, sessionJSON(MEMBER_A, 3600)));
      await createAs();
      await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
      expect(screen.queryByText(en('auth.check_email'))).toBeNull();
    });

    it('through "I\'ve confirmed, sign me in" with what was typed', async () => {
      await openSignUp();
      authHost.on('POST', '/auth/v1/signup', NO_SESSION);
      authHost.on('POST', '/auth/v1/token', Reply.json(200, sessionJSON(MEMBER_A, 3600)));
      await createAs();
      await waitFor(() => expect(screen.getByText(en('auth.check_email'))).toBeOnTheScreen());
      await fireEvent.press(screen.getByRole('button', { name: en('auth.android.confirmed_sign_in') }));

      await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
      expect(authHost.sent('/auth/v1/token', 'POST').body).toMatchObject({
        email: 'member@example.is',
        password: 'a long password ',
      });
    });

    it('which, before the link is tapped, asks for it to be tapped', async () => {
      await openSignUp();
      authHost.on('POST', '/auth/v1/signup', NO_SESSION);
      authHost.on('POST', '/auth/v1/token', Reply.json(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }));
      await createAs();
      await waitFor(() => expect(screen.getByText(en('auth.check_email'))).toBeOnTheScreen());
      await fireEvent.press(screen.getByRole('button', { name: en('auth.android.confirmed_sign_in') }));
      await waitFor(() => expect(screen.getByText(en('auth.err.unconfirmed'))).toBeOnTheScreen());
      expect(useAppStore.getState().isAuthenticated).toBe(false);
    });
  });
});

describe('"Already have an account? Sign in"', () => {
  it('replaces Sign up with Log in after onboarding', async () => {
    await openSignUp();
    await fireEvent.press(screen.getByRole('button', { name: en('auth.signin') }));
    expect(authStack()).toEqual(['Onboarding', 'Login']);
  });

  it('goes back to Log in when the member came from there', async () => {
    await openSignUp('en', 'login');
    await fireEvent.press(screen.getByRole('button', { name: en('auth.signin') }));
    expect(authStack()).toEqual(['Onboarding', 'Login']);
  });
});

it('the eye button shows the password and says what a tap does', async () => {
  await openSignUp();
  await fill({ password: 'a long password' });
  expect(field('password')).toHaveProp('secureTextEntry', true);
  await fireEvent.press(screen.getByRole('button', { name: en('auth.android.show_password') }));
  expect(field('password')).toHaveProp('secureTextEntry', false);
  expect(field('password')).toHaveDisplayValue('a long password');
  expect(screen.getByRole('button', { name: en('auth.android.hide_password') })).toBeOnTheScreen();
});
