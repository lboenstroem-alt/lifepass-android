/**
 * The Kenni sheet (iOS KenniVerificationView): the iOS copy in both
 * languages, the data note with its privacy link before every start, the
 * failure sentence spoken to TalkBack, Try again, Contact support and Sign in
 * with another account where iOS offers them, "See visitor passes" only from
 * Plans, and a verification that re-reads the profile and ends on Continue.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply, type StubReply } from '@test/server';
import { useState } from 'react';
import { AccessibilityInfo, Linking, Pressable } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeProfile } from '../../../api/profile';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { setCurrentLanguage, translate, type Lang } from '../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import KenniSheet, { KENNI_SUPPORT_URL, type KenniSheetOutcome, type KenniSheetProps } from '../KenniSheet';
import { failureMessageKey, KENNI_FAILURES, type KenniFailure } from '../model';
import { KenniWebAuthError, type Authenticate } from '../webAuth';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const GOOD_CALLBACK = 'lifepass://kenni-callback?code=the-code&state=the-state';
const AUTHORIZATION_URL = 'https://idp.kenni.is/sporta/oidc/auth?client_id=x';
const en = (key: string) => translate(key, 'en');
const originalSignOut = useAppStore.getState().signOut;

function signIn(kennitalaVerified = false) {
  const json = { id: MEMBER, locale: 'en', kennitalaVerified, marketingConsent: false };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok(json));
}

function answer({ start, complete }: { start?: StubReply; complete?: StubReply } = {}) {
  api.on('POST', '/auth/kenni/start', start ?? Reply.ok({ alreadyVerified: false, authorizationUrl: AUTHORIZATION_URL }));
  api.on('POST', '/auth/kenni/complete', complete ?? Reply.ok({ verified: true, kennitalaVerified: true, claims: 0 }));
}

type HarnessProps = Partial<Omit<KenniSheetProps, 'visible'>> & { closes?: jest.Mock };

function Harness({ closes, onClosed, authenticate, ...props }: HarnessProps) {
  const [visible, setVisible] = useState(true);
  return (
    <KenniSheet
      {...props}
      visible={visible}
      authenticate={authenticate ?? (async () => GOOD_CALLBACK)}
      onClose={() => {
        closes?.();
        setVisible(false);
      }}
      onClosed={onClosed}
    />
  );
}

const verifyButton = (lang: Lang = 'en') => screen.getByRole('button', { name: translate('kenni.cta', lang) });
const retryButton = () => screen.getByRole('button', { name: en('kenni.retry') });

async function endWith(failureReply: StubReply | null, authenticate?: Authenticate) {
  answer(failureReply ? { complete: failureReply } : {});
  await render(<Harness authenticate={authenticate} />);
  await fireEvent.press(verifyButton());
}

let announced: jest.SpyInstance;
let openURL: jest.SpyInstance;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  useAppStore.setState({ signOut: originalSignOut });
  resetAppStoreForTests();
  jest.restoreAllMocks();
});

it("before the first try: iOS's title, body, data note with the privacy link, the button and the passes note", async () => {
  signIn();
  await render(<Harness />);
  expect(screen.getByRole('header', { name: en('kenni.title') })).toBeOnTheScreen();
  expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
  expect(screen.getByTestId('kenni.data_note')).toHaveTextContent(`${en('kenni.data_note')} ${en('kenni.privacy_link')}`);
  expect(verifyButton()).toBeEnabled();
  expect(screen.getByText(en('kenni.passes_note'))).toBeOnTheScreen();
  // Only the plans screen offers the way to the passes.
  expect(screen.queryByText(en('kenni.see_passes'))).toBeNull();
  expect(screen.queryByTestId('kenni.failure')).toBeNull();

  await fireEvent.press(screen.getByTestId('kenni.privacy_link'));
  expect(openURL).toHaveBeenCalledWith('https://lifepass.is/privacy');
});

it('the sign-up nudge and the refusal step carry their own body', async () => {
  signIn();
  await render(<Harness bodyKey="kenni.onboarding_body" />);
  expect(screen.getByText(en('kenni.onboarding_body'))).toBeOnTheScreen();
  expect(screen.queryByText(en('kenni.body'))).toBeNull();
});

it('speaks Icelandic when the app does', async () => {
  signIn();
  setCurrentLanguage('is');
  await render(<Harness />);
  expect(screen.getByRole('header', { name: translate('kenni.title', 'is') })).toBeOnTheScreen();
  expect(verifyButton('is')).toBeOnTheScreen();
  expect(screen.getByText(translate('common.cancel', 'is'))).toBeOnTheScreen();
});

it('a verification re-reads the profile and ends on Continue, which closes the sheet verified', async () => {
  signIn();
  answer();
  api.on('GET', '/profile', Reply.ok({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false }));
  const closes = jest.fn();
  const closed = jest.fn<void, [KenniSheetOutcome]>();
  await render(<Harness closes={closes} onClosed={closed} />);
  await fireEvent.press(verifyButton());

  await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
  await waitFor(() => expect(useAppStore.getState().profile?.kennitalaVerified).toBe(true));
  expect(screen.queryByTestId('kenni.data_note')).toBeNull();
  expect(screen.queryByText(en('kenni.passes_note'))).toBeNull();
  expect(screen.queryByRole('button', { name: en('kenni.cta') })).toBeNull();
  expect(announced).toHaveBeenCalledWith(en('kenni.verified'));

  await fireEvent.press(screen.getByRole('button', { name: en('common.continue') }));
  expect(closes).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(closed).toHaveBeenCalledWith({ verified: true }));
});

it('an already verified member never sees a browser', async () => {
  signIn();
  answer({ start: Reply.ok({ alreadyVerified: true }) });
  const authenticate = jest.fn(async () => GOOD_CALLBACK);
  await render(<Harness authenticate={authenticate} />);
  await fireEvent.press(verifyButton());
  await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
  expect(authenticate).not.toHaveBeenCalled();
});

it('a cancel says so, speaks it, and offers Try again with the data note again', async () => {
  signIn();
  await endWith(null, async () => {
    throw new KenniWebAuthError('cancelled');
  });
  await waitFor(() => expect(screen.getByTestId('kenni.failure')).toBeOnTheScreen());
  expect(screen.getByText(en('kenni.err.cancelled'))).toBeOnTheScreen();
  expect(screen.getByTestId('kenni.failure').props.accessibilityLabel).toBe(en('kenni.err.cancelled'));
  expect(announced).toHaveBeenCalledWith(en('kenni.err.cancelled'));
  expect(retryButton()).toBeEnabled();
  expect(screen.getByTestId('kenni.data_note')).toBeOnTheScreen();
  expect(screen.queryByText(en('kenni.support'))).toBeNull();
  expect(screen.queryByText(en('kenni.sign_in_other'))).toBeNull();
});

it('a kennitala already on another account: no Try again, no data note, support and sign in with another account', async () => {
  signIn();
  const signOut = jest.fn(async () => undefined);
  useAppStore.setState({ signOut });
  const closes = jest.fn();
  answer({ complete: Reply.problem(409, 'kennitala_already_linked') });
  await render(<Harness closes={closes} />);
  await fireEvent.press(verifyButton());

  await waitFor(() => expect(screen.getByText(en('kenni.err.linked'))).toBeOnTheScreen());
  expect(screen.queryByRole('button', { name: en('kenni.retry') })).toBeNull();
  expect(screen.queryByRole('button', { name: en('kenni.cta') })).toBeNull();
  expect(screen.queryByTestId('kenni.data_note')).toBeNull();
  expect(screen.getByText(en('kenni.passes_note'))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('link', { name: en('kenni.support') }));
  expect(openURL).toHaveBeenCalledWith(KENNI_SUPPORT_URL);
  expect(KENNI_SUPPORT_URL).toBe('mailto:support@lifepass.is');

  const other = screen.getByRole('button', { name: en('kenni.sign_in_other') });
  expect(other.props.accessibilityHint).toBe(en('kenni.sign_in_other_hint'));
  await fireEvent.press(other);
  expect(closes).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('a server failure keeps Try again above support and sign in with another account', async () => {
  signIn();
  await endWith(Reply.problem(500, 'internal_error'));
  await waitFor(() => expect(screen.getByText(en('kenni.err.server'))).toBeOnTheScreen());
  expect(retryButton()).toBeEnabled();
  expect(screen.getByRole('link', { name: en('kenni.support') })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en('kenni.sign_in_other') })).toBeOnTheScreen();
  expect(screen.getByTestId('kenni.data_note')).toBeOnTheScreen();
});

it('Try again after a cancel can verify', async () => {
  signIn();
  let cancelFirst = true;
  await endWith(null, async () => {
    if (cancelFirst) {
      cancelFirst = false;
      throw new KenniWebAuthError('cancelled');
    }
    return GOOD_CALLBACK;
  });
  await waitFor(() => expect(retryButton()).toBeOnTheScreen());
  await fireEvent.press(retryButton());
  await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
  expect(screen.queryByTestId('kenni.failure')).toBeNull();
});

it('from Plans, "See visitor passes" shows the passes and closes the sheet unverified', async () => {
  signIn();
  const order: string[] = [];
  const closed = jest.fn<void, [KenniSheetOutcome]>();
  await render(
    <Harness onSeePasses={() => order.push('passes')} closes={jest.fn(() => order.push('close'))} onClosed={closed} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: en('kenni.see_passes') }));
  expect(order).toEqual(['passes', 'close']);
  await waitFor(() => expect(closed).toHaveBeenCalledWith({ verified: false }));
});

it('Cancel closes it at any time, and a fresh presentation starts clean', async () => {
  signIn();
  answer({ complete: Reply.problem(410, 'kenni_state_expired') });
  function Reopening() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <KenniSheet visible={visible} authenticate={async () => GOOD_CALLBACK} onClose={() => setVisible(false)} />
        <KenniReopen onPress={() => setVisible(true)} />
      </>
    );
  }
  await render(<Reopening />);
  await fireEvent.press(verifyButton());
  await waitFor(() => expect(screen.getByText(en('kenni.err.expired'))).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
  await waitFor(() => expect(screen.queryByText(en('kenni.title'))).toBeNull());
  await fireEvent.press(screen.getByTestId('reopen'));
  await waitFor(() => expect(screen.getByText(en('kenni.title'))).toBeOnTheScreen());
  expect(screen.queryByTestId('kenni.failure')).toBeNull();
  expect(verifyButton()).toBeOnTheScreen();
});

it('the button shows it is working and refuses a second start', async () => {
  signIn();
  answer();
  let release: (url: string) => void = () => undefined;
  await render(<Harness authenticate={() => new Promise<string>((resolve) => (release = resolve))} />);
  await fireEvent.press(verifyButton());
  await waitFor(() => expect(verifyButton()).toBeDisabled());
  await fireEvent.press(verifyButton());
  expect(api.sentAll('/auth/kenni/start')).toHaveLength(1);
  await act(async () => release(GOOD_CALLBACK));
  await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
});

it('a resume link completes as soon as the sheet shows, without a browser', async () => {
  signIn();
  answer();
  const authenticate = jest.fn(async () => GOOD_CALLBACK);
  await render(<Harness authenticate={authenticate} resumeUrl={GOOD_CALLBACK} />);
  await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
  expect(authenticate).not.toHaveBeenCalled();
  expect(api.sentAll('/auth/kenni/start')).toHaveLength(0);
  expect(api.sent('/auth/kenni/complete', 'POST').body).toEqual({ code: 'the-code', state: 'the-state' });
});

describe('every failure sentence, in English and Icelandic', () => {
  const replies: Record<KenniFailure, { complete?: StubReply; start?: StubReply; tab?: KenniWebAuthError }> = {
    cancelled: { tab: new KenniWebAuthError('cancelled') },
    expired: { complete: Reply.problem(410, 'kenni_state_expired') },
    alreadyLinked: { complete: Reply.problem(409, 'kennitala_already_linked') },
    serverError: { complete: Reply.problem(503, 'service_unavailable') },
    offline: { complete: Reply.fail() },
    couldNotStart: { start: Reply.problem(500, 'internal_error') },
    failed: { complete: Reply.problem(403, 'kenni_state_profile_mismatch') },
  };
  const cases = KENNI_FAILURES.flatMap((failure) => (['en', 'is'] as const).map((lang) => [failure, lang] as const));

  it.each(cases)('%s in %s', async (failure, lang) => {
    signIn();
    setCurrentLanguage(lang);
    const reply = replies[failure];
    answer({ start: reply.start, complete: reply.complete });
    await render(
      <Harness
        authenticate={async () => {
          if (reply.tab) throw reply.tab;
          return GOOD_CALLBACK;
        }}
      />,
    );
    await fireEvent.press(verifyButton(lang));
    const sentence = translate(failureMessageKey(failure), lang);
    await waitFor(() => expect(screen.getByText(sentence)).toBeOnTheScreen());
    expect(sentence).not.toBe(failureMessageKey(failure));
    expect(announced).toHaveBeenCalledWith(sentence);
  });
});

/** A stand-in for the opener's button, outside the sheet. */
function KenniReopen({ onPress }: { onPress: () => void }) {
  return <Pressable testID="reopen" onPress={onPress} />;
}

it('a completion that lands after Cancel still re-reads the profile, and says nothing to a closed sheet', async () => {
  signIn();
  answer();
  api.on('GET', '/profile', Reply.ok({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false }));
  let release: (url: string) => void = () => undefined;
  const closed = jest.fn<void, [KenniSheetOutcome]>();
  await render(<Harness onClosed={closed} authenticate={() => new Promise<string>((resolve) => (release = resolve))} />);
  await fireEvent.press(verifyButton());
  await waitFor(() => expect(verifyButton()).toBeDisabled());
  await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
  await waitFor(() => expect(closed).toHaveBeenCalledWith({ verified: false }));

  await act(async () => release(GOOD_CALLBACK));
  await waitFor(() => expect(useAppStore.getState().profile?.kennitalaVerified).toBe(true));
  expect(announced).not.toHaveBeenCalledWith(en('kenni.verified'));
});
