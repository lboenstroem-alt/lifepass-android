/**
 * The Kenni host the tabs shell mounts (iOS MainTabView's nudge `.sheet`, and
 * the sheet every `openKenniSheet` caller asks for): the nudge's close is
 * persisted once per phone, a retract by the app is not, an opener hears its
 * sheet closed once it has gone, and a redirect that came without its tab
 * (Android stopped the app, recreated the Activity, or the redirect lost the
 * race) is completed once, by the sheet on screen, and only for a round trip
 * this phone started for this member.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import * as WebBrowser from 'expo-web-browser';
import { AccessibilityInfo, Linking } from 'react-native';

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
import { resetKenniCallbackLinksForTests } from '../callbackLink';
import { KENNI_RESUME_WINDOW_MS, KENNI_ROUND_TRIP_KEY } from '../roundTrip';
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

/** This phone opened a tab for `member` `ago` ms ago (./roundTrip.ts). */
async function roundTripStarted(member: string = MEMBER, ago = 60_000) {
  await AsyncStorage.setItem(KENNI_ROUND_TRIP_KEY, JSON.stringify({ startedAt: Date.now() - ago, member }));
}

/** The app's own link events, as the host and the tab listen for them. */
type UrlHandler = (event: { url: string }) => void;
let urlHandlers: UrlHandler[];
const sendLink = (url: string) => {
  for (const handler of [...urlHandlers]) handler({ url });
};
let launchUrl: string | null;

let closures: KenniSheetOutcome[];
let stopListening: () => void;

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetKenniSheetRequestsForTests();
  resetKenniWebAuthForTests();
  resetKenniCallbackLinksForTests();
  setKenniLateRedirectGraceForTests(0);
  openTab.mockReset();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  urlHandlers = [];
  launchUrl = null;
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((type: string, handler: UrlHandler) => {
    urlHandlers.push(handler);
    return {
      remove: () => {
        urlHandlers = urlHandlers.filter((h) => h !== handler);
      },
    };
  }) as never);
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(async () => launchUrl);
  closures = [];
  stopListening = onKenniSheetClosed((outcome) => closures.push(outcome));
});

afterEach(() => {
  stopListening();
  useAppStore.setState({ signOut: originalSignOut });
  resetKenniSheetRequestsForTests();
  resetKenniCallbackLinksForTests();
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

describe('a kenni-callback link that came without its tab', () => {
  it('is only ours when it is a Kenni redirect', () => {
    expect(isKenniCallbackUrl(GOOD_CALLBACK)).toBe(true);
    expect(isKenniCallbackUrl('lifepass://kenni-callback')).toBe(true);
    expect(isKenniCallbackUrl('LIFEPASS://KENNI-CALLBACK?code=c')).toBe(true);
    expect(isKenniCallbackUrl('lifepass://kenni-callbackx?code=c')).toBe(false);
    expect(isKenniCallbackUrl('lifepass://auth/callback?code=c')).toBe(false);
    expect(isKenniCallbackUrl(null)).toBe(false);
    expect(handleKenniCallbackLink('lifepass://scan?v=x')).toBe(false);
  });

  it('after Android stopped the app: the launch link opens the sheet and completes, without a browser', async () => {
    signIn();
    verifiesOnTheServer();
    await roundTripStarted();
    launchUrl = GOOD_CALLBACK;
    await render(<KenniNudgeHost />);
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
    expect(openTab).not.toHaveBeenCalled();
    expect(api.sentAll('/auth/kenni/start')).toHaveLength(0);
    expect(api.sent('/auth/kenni/complete', 'POST').body).toEqual({ code: 'the-code', state: 'the-state' });
    // The state is spent: the record that allowed it is gone.
    expect(await AsyncStorage.getItem(KENNI_ROUND_TRIP_KEY)).toBeNull();
  });

  it('arriving while the session is still restoring, it waits for the host instead of being dropped', async () => {
    useAppStore.setState({ isLoading: true, isAuthenticated: false, userId: null, profile: null });
    await roundTripStarted();
    expect(handleKenniCallbackLink(GOOD_CALLBACK)).toBe(true);
    expect(isKenniSheetRequested()).toBe(false);

    // Restored: the tabs (and the host) come up.
    signIn();
    useAppStore.setState({ isLoading: false });
    verifiesOnTheServer();
    await render(<KenniNudgeHost />);
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);
  });

  it('a link replayed from Recents after it was completed (no round trip on record) does nothing', async () => {
    signIn();
    verifiesOnTheServer();
    launchUrl = GOOD_CALLBACK;
    await render(<KenniNudgeHost />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sheetTitle()).toBeNull();
    expect(isKenniSheetRequested()).toBe(false);
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(0);
  });

  it('is completed once: the same launch link at the next mount does nothing', async () => {
    signIn();
    verifiesOnTheServer();
    await roundTripStarted();
    launchUrl = GOOD_CALLBACK;
    const first = await render(<KenniNudgeHost />);
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    await first.unmount();
    resetKenniSheetRequestsForTests();

    // A fresh process (the record is what survives it) with the same launch link.
    resetKenniCallbackLinksForTests();
    signIn();
    await render(<KenniNudgeHost />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sheetTitle()).toBeNull();
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);
  });

  it("is dropped for another member's round trip, a stale one, or a profile already verified", async () => {
    signIn();
    verifiesOnTheServer();
    await render(<KenniNudgeHost />);
    const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    await roundTripStarted('another-member');
    await act(async () => void handleKenniCallbackLink(`${GOOD_CALLBACK}&n=1`));
    await settle();
    expect(isKenniSheetRequested()).toBe(false);

    await roundTripStarted(MEMBER, KENNI_RESUME_WINDOW_MS + 1_000);
    await act(async () => void handleKenniCallbackLink(`${GOOD_CALLBACK}&n=2`));
    await settle();
    expect(isKenniSheetRequested()).toBe(false);

    await roundTripStarted();
    signIn(true);
    await act(async () => void handleKenniCallbackLink(`${GOOD_CALLBACK}&n=3`));
    await settle();
    expect(isKenniSheetRequested()).toBe(false);
    expect(await AsyncStorage.getItem(KENNI_ROUND_TRIP_KEY)).toBeNull();
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(0);
  });

  it("later than the tab's grace: the sheet that said cancelled finishes it, keeping its opener", async () => {
    signIn();
    verifiesOnTheServer();
    openTab.mockResolvedValue({ type: 'dismiss' } as never);
    const onClose = jest.fn();
    const onSeePasses = jest.fn();
    await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onSeePasses, onClose }));
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(screen.getByText(en('kenni.err.cancelled'))).toBeOnTheScreen());

    await act(async () => sendLink(GOOD_CALLBACK));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    // The same sheet: its opener was not told it closed, its body stayed.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
    expect(screen.getAllByRole('header', { name: en('kenni.title') })).toHaveLength(1);
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);

    await waitFor(() => expect(useAppStore.getState().profile?.kennitalaVerified).toBe(true));
    await fireEvent.press(screen.getByRole('button', { name: en('common.continue') }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(closures).toEqual([{ verified: true }]);
  });

  it('with the sign-up nudge up, the nudge finishes it in its own words', async () => {
    signIn();
    verifiesOnTheServer();
    await roundTripStarted();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    launchUrl = GOOD_CALLBACK;
    await render(<KenniNudgeHost />);
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(screen.getByText(en('kenni.onboarding_body'))).toBeOnTheScreen();
    expect(isKenniSheetRequested()).toBe(false);
  });

  it("while a tab is open, goes to the tab's session, which ends verified rather than cancelled", async () => {
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

    // A recreated Activity's launch link: never a link event the tab hears.
    expect(handleKenniCallbackLink(GOOD_CALLBACK)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ type: 'dismiss' } as never));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(screen.queryByText(en('kenni.err.cancelled'))).toBeNull();
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);
  });

  it('caught by a tab whose sheet was rebuilt meanwhile, it is finished by the sheet on screen now', async () => {
    signIn();
    verifiesOnTheServer();
    let finish: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
    openTab.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const onClose = jest.fn();
    const before = await render(<KenniNudgeHost />);
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose }));
    await fireEvent.press(screen.getByRole('button', { name: en('kenni.cta') }));
    await waitFor(() => expect(openTab).toHaveBeenCalledTimes(1));

    // Android rebuilt the app's views behind the eID app: a new host shows the same request.
    await before.unmount();
    await render(<KenniNudgeHost />);
    expect(screen.getByText(en('kenni.body'))).toBeOnTheScreen();
    await act(async () => finish({ type: 'success', url: GOOD_CALLBACK }));
    await waitFor(() => expect(screen.getByText(en('kenni.verified'))).toBeOnTheScreen());
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is forgotten at sign-out, with the round trip it belonged to', async () => {
    useAppStore.setState({ isLoading: true, isAuthenticated: false });
    await roundTripStarted();
    handleKenniCallbackLink(GOOD_CALLBACK);
    await act(async () => runSignOutCleaners({ memberId: MEMBER }));
    expect(await AsyncStorage.getItem(KENNI_ROUND_TRIP_KEY)).toBeNull();

    signIn();
    verifiesOnTheServer();
    await render(<KenniNudgeHost />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sheetTitle()).toBeNull();
    expect(api.sentAll('/auth/kenni/complete')).toHaveLength(0);
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
