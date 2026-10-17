/**
 * The Kenni host the tabs shell mounts (iOS MainTabView's nudge `.sheet`, and
 * the sheet every `openKenniSheet` caller asks for): the nudge's close is
 * persisted once per phone, a retract by the app is not, an opener hears its
 * sheet closed once it has gone, and a redirect that reaches the router after
 * Android stopped the app is completed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import * as WebBrowser from 'expo-web-browser';
import { AccessibilityInfo } from 'react-native';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeProfile } from '../../../api/profile';
import { runSignOutCleaners } from '../../../app/signOut';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { translate } from '../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import {
  handleKenniCallbackLink,
  isKenniCallbackUrl,
  isKenniSheetRequested,
  KenniNudgeHost,
  onKenniSheetClosed,
  openKenniSheet,
  type KenniSheetOutcome,
} from '..';
import { resetKenniSheetRequestsForTests } from '../sheetRequests';
import { resetKenniWebAuthForTests, setKenniLateRedirectGraceForTests } from '../webAuth';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const DISMISSED_KEY = 'kennitalaPromptDismissed';
const GOOD_CALLBACK = 'lifepass://kenni-callback?code=the-code&state=the-state';
const en = (key: string) => translate(key, 'en');
const openTab = WebBrowser.openAuthSessionAsync as jest.MockedFunction<typeof WebBrowser.openAuthSessionAsync>;
const originalSignOut = useAppStore.getState().signOut;

function signIn(kennitalaVerified = false) {
  const json = { id: MEMBER, locale: 'en', kennitalaVerified, marketingConsent: false };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok(json));
}

function verifiesOnTheServer() {
  api.on('POST', '/auth/kenni/start', Reply.ok({ alreadyVerified: false, authorizationUrl: 'https://idp.kenni.is/x' }));
  api.on('POST', '/auth/kenni/complete', Reply.ok({ verified: true, kennitalaVerified: true, claims: 1 }));
  api.on('GET', '/profile', Reply.ok({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false }));
  openTab.mockResolvedValue({ type: 'success', url: GOOD_CALLBACK });
}

const sheetTitle = () => screen.queryByRole('header', { name: en('kenni.title') });
const cancel = () => fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));

let closures: KenniSheetOutcome[];
let stopListening: () => void;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetKenniSheetRequestsForTests();
  resetKenniWebAuthForTests();
  setKenniLateRedirectGraceForTests(0);
  openTab.mockReset();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  closures = [];
  stopListening = onKenniSheetClosed((outcome) => closures.push(outcome));
});

afterEach(() => {
  stopListening();
  useAppStore.setState({ signOut: originalSignOut });
  resetKenniSheetRequestsForTests();
  resetAppStoreForTests();
  jest.restoreAllMocks();
});

describe('the post-sign-up nudge', () => {
  it('shows the sign-up body; closing it persists the dismissal, once per phone', async () => {
    signIn();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await render(<KenniNudgeHost />);
    expect(sheetTitle()).toBeOnTheScreen();
    expect(screen.getByText(en('kenni.onboarding_body'))).toBeOnTheScreen();
    expect(screen.queryByText(en('kenni.see_passes'))).toBeNull();

    await cancel();
    expect(useAppStore.getState().pendingKennitalaPrompt).toBe(false);
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('true');
    await waitFor(() => expect(sheetTitle()).toBeNull());
    expect(closures).toEqual([{ verified: false }]);
  });

  it('retracted by the app (a check-in link, sign-out), it persists nothing and can arm again', async () => {
    signIn();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await render(<KenniNudgeHost />);
    expect(sheetTitle()).toBeOnTheScreen();

    await act(async () => useAppStore.setState({ pendingKennitalaPrompt: false }));
    await waitFor(() => expect(sheetTitle()).toBeNull());
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it('verified from the nudge, Continue closes it for good and the profile says verified', async () => {
    signIn();
    verifiesOnTheServer();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await render(<KenniNudgeHost />);
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(openTab).toHaveBeenCalledWith('https://idp.kenni.is/x', 'lifepass://kenni-callback', { createTask: false });
    await waitFor(() => expect(useAppStore.getState().profile?.kennitalaVerified).toBe(true));

    await fireEvent.press(screen.getByRole('button', { name: en('common.continue') }));
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('true');
    await waitFor(() => expect(closures).toEqual([{ verified: true }]));
  });

  it('"Sign in with another account" counts as closing it, and signs out', async () => {
    signIn();
    const signOut = jest.fn(async () => undefined);
    useAppStore.setState({ signOut, pendingKennitalaPrompt: true });
    api.on('POST', '/auth/kenni/start', Reply.ok({ alreadyVerified: false, authorizationUrl: 'https://idp.kenni.is/x' }));
    api.on('POST', '/auth/kenni/complete', Reply.problem(409, 'kennitala_already_linked'));
    openTab.mockResolvedValue({ type: 'success', url: GOOD_CALLBACK });
    await render(<KenniNudgeHost />);
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(screen.getByText(en('kenni.err.linked'))).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole('button', { name: en('kenni.sign_in_other') }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('true');
  });

  it('a closed tab says it was cancelled and keeps the sheet up', async () => {
    signIn();
    api.on('POST', '/auth/kenni/start', Reply.ok({ alreadyVerified: false, authorizationUrl: 'https://idp.kenni.is/x' }));
    openTab.mockResolvedValue({ type: 'dismiss' } as never);
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await render(<KenniNudgeHost />);
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(screen.getByText(en('kenni.err.cancelled'))).toBeOnTheScreen());
    expect(sheetTitle()).toBeOnTheScreen();
    expect(useAppStore.getState().pendingKennitalaPrompt).toBe(true);
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(0);
  });
});

describe('a request', () => {
  it("shows the opener's body and See visitor passes; the opener hears onClose once the sheet has gone", async () => {
    signIn();
    const onClose = jest.fn();
    const onSeePasses = jest.fn();
    await render(<KenniNudgeHost />);
    expect(sheetTitle()).toBeNull();

    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onSeePasses, onClose }));
    expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.see_passes') }));
    expect(onSeePasses).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sheetTitle()).toBeNull();
    expect(isKenniSheetRequested()).toBe(false);
    expect(closures).toEqual([{ verified: false }]);
    // Not a nudge: nothing is persisted.
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it('a request over an armed nudge is the same sheet: closing it handles the nudge too', async () => {
    signIn();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    const onClose = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
    expect(screen.queryByText(en('kenni.onboarding_body'))).toBeNull();

    await cancel();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('true');
    await waitFor(() => expect(sheetTitle()).toBeNull());
  });

  it('a second request replaces the first, which hears its sheet closed', async () => {
    signIn();
    const first = jest.fn();
    const second = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose: first }));
    await act(async () => openKenniSheet({ bodyKey: 'kenni.onboarding_body', onClose: second }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en('kenni.onboarding_body'))).toBeOnTheScreen();

    await cancel();
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('is forgotten at sign-out, without telling its opener', async () => {
    signIn();
    const onClose = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    await act(async () => runSignOutCleaners({ memberId: MEMBER }));
    await waitFor(() => expect(sheetTitle()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a kenni-callback link that reached the router', () => {
  it('is only ours when it is a Kenni redirect', () => {
    expect(isKenniCallbackUrl(GOOD_CALLBACK)).toBe(true);
    expect(isKenniCallbackUrl('lifepass://kenni-callback')).toBe(true);
    expect(isKenniCallbackUrl('LIFEPASS://KENNI-CALLBACK?code=c')).toBe(true);
    expect(isKenniCallbackUrl('lifepass://kenni-callbackx?code=c')).toBe(false);
    expect(isKenniCallbackUrl('lifepass://auth/callback?code=c')).toBe(false);
    expect(isKenniCallbackUrl(null)).toBe(false);
    expect(handleKenniCallbackLink('lifepass://scan?v=x')).toBe(false);
  });

  it('after Android stopped the app, opens the sheet and completes the verification', async () => {
    signIn();
    verifiesOnTheServer();
    await render(<KenniNudgeHost />);
    let handled = false;
    await act(async () => {
      handled = handleKenniCallbackLink(GOOD_CALLBACK);
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(openTab).not.toHaveBeenCalled();
    expect(api.sentAll('/auth/kenni/start')).toHaveLength(0);
    expect(api.sent('/auth/kenni/complete', 'POST').body).toEqual({ code: 'the-code', state: 'the-state' });
  });

  it('is left to the open tab while one is waiting, and does nothing signed out', async () => {
    signIn();
    let finish: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
    openTab.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    api.on('POST', '/auth/kenni/start', Reply.ok({ alreadyVerified: false, authorizationUrl: 'https://idp.kenni.is/x' }));
    api.on('POST', '/auth/kenni/complete', Reply.ok({ verified: true, kennitalaVerified: true, claims: 0 }));
    const onClose = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));

    expect(handleKenniCallbackLink(GOOD_CALLBACK)).toBe(true);
    // The same request is still the one on screen; the tab's session completes.
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ type: 'success', url: GOOD_CALLBACK }));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);

    useAppStore.setState({ isAuthenticated: false });
    await cancel();
    await waitFor(() => expect(isKenniSheetRequested()).toBe(false));
    expect(handleKenniCallbackLink(GOOD_CALLBACK)).toBe(true);
    expect(isKenniSheetRequested()).toBe(false);
  });
});

describe('a kenni-callback link the tab already completed', () => {
  it('reaching the router just after the tab closed is never completed again', async () => {
    signIn();
    verifiesOnTheServer();
    const onClose = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());

    let handled = false;
    await act(async () => {
      handled = handleKenniCallbackLink(GOOD_CALLBACK);
    });
    expect(handled).toBe(true);
    // Still the opener's sheet, still verified, and the state was spent once.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen();
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);
  });
});

describe('with the app store', () => {
  // The arming rules themselves are F3's (src/stores/__tests__/sessionLifecycle.test.ts).
  it("a verification's profile read is not an app entry: the nudge is never armed again or doubled", async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const unverified = { id: MEMBER, locale: 'en', kennitalaVerified: false, marketingConsent: false, createdAt: fresh };
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(unverified), pendingKennitalaPrompt: true });
    await render(<KenniNudgeHost />);
    expect(screen.getByText(en('kenni.onboarding_body'))).toBeOnTheScreen();

    verifiesOnTheServer();
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(useAppStore.getState().profile?.kennitalaVerified).toBe(true));
    expect(screen.getAllByRole('header', { name: en('kenni.title') })).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: en('common.continue') }));
    await waitFor(() => expect(sheetTitle()).toBeNull());
    expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('true');

    await act(async () => useAppStore.getState().loadProfile());
    expect(useAppStore.getState().pendingKennitalaPrompt).toBe(false);
    expect(sheetTitle()).toBeNull();
  });
});
