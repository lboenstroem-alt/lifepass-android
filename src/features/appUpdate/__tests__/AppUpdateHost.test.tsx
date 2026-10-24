/**
 * The update prompt on screen: the block below the minimum (Update opens
 * Google Play, in Icelandic too, and nothing behind it can be reached; at the
 * largest font size its words scroll and Update stays pinned below them), the
 * soft prompt once the launch screen has gone (only an answer keeps it away
 * for that version), and nothing at all when the check fails, including a
 * failed re-check under a block.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppState, Linking, Text, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { FONT_SCALE_CAP } from '../../../hooks/useA11ySize';
import { lookup, setCurrentLanguage } from '../../../i18n';
import { resetNavPrefsForTests, setLaunchTab, useNavPrefs } from '../../../navigation/navPrefs';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import AppUpdateHost from '../AppUpdateHost';
import { marketUrl, openPlayStore } from '../openStore';
import {
  DISMISSED_LATEST_VERSION_KEY,
  resetAppUpdateForTests,
  setAppUpdateDepsForTests,
  useAppUpdate,
} from '../updateStore';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const PLAY = 'https://play.google.com/store/apps/details?id=is.lifepass.android';
const MARKET = 'market://details?id=is.lifepass.android';
const en = (key: string) => lookup(key, 'en');
const is = (key: string) => lookup(key, 'is');

function serve(minimumVersion: string | null, latestVersion: string | null) {
  api.on('GET', '/app-version', Reply.ok({ platform: 'android', minimumVersion, latestVersion, storeUrl: PLAY }));
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

let openURL: jest.SpyInstance;

beforeEach(() => {
  resetAppUpdateForTests();
  resetAppStoreForTests();
  setAppUpdateDepsForTests({ currentVersion: () => '2.5.6' });
  // The launch screen has gone: the session is resolved and the tab chosen.
  useAppStore.setState({ isLoading: false });
  setLaunchTab('Explore');
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
  restoreTestFontScale();
  resetAppUpdateForTests();
  resetAppStoreForTests();
  resetNavPrefsForTests();
});

/** What this phone keeps of the soft prompt's answer. */
const answered = () => AsyncStorage.getItem(DISMISSED_LATEST_VERSION_KEY);

it('below the minimum: a cover with one Update button, which opens the Play Store app', async () => {
  serve('2.6.0', '2.6.0');
  await render(
    <>
      <Text>Behind</Text>
      <AppUpdateHost />
    </>,
  );
  await settle();

  expect(screen.getByTestId('appupdate.required')).toBeOnTheScreen();
  expect(screen.getByText(en('appupdate.required.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('appupdate.required.body'))).toBeOnTheScreen();
  // The soft prompt never shows under a block.
  expect(screen.queryByTestId('appupdate.available')).toBeNull();

  await fireEvent.press(screen.getByTestId('appupdate.required.update'));
  expect(openURL).toHaveBeenCalledWith(MARKET);
  // Still blocked after the store opened: only installing the update lifts it.
  expect(screen.getByTestId('appupdate.required')).toBeOnTheScreen();
});

it('in Icelandic, and the web listing when the Play Store app cannot be opened', async () => {
  setCurrentLanguage('is');
  serve('2.6.0', null);
  openURL.mockImplementation(async (url: string) => {
    if (url.startsWith('market:')) throw new Error('No Activity found to handle Intent');
    return true;
  });
  await render(<AppUpdateHost />);
  await settle();

  expect(screen.getByText(is('appupdate.required.title'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: is('appupdate.update') }));
  await settle();
  expect(openURL.mock.calls.map(([url]) => url)).toEqual([MARKET, PLAY]);
  expect(screen.queryByTestId('appupdate.required.storeFailed')).toBeNull();
});

it('at the largest font size on a small phone, in Icelandic: the title and body scroll, Update is pinned below them', async () => {
  setTestFontScale(2);
  setCurrentLanguage('is');
  serve('2.6.0', null);
  await render(<AppUpdateHost />);
  await settle();

  const scroll = screen.getByTestId('appupdate.required.scroll');
  const footer = screen.getByTestId('appupdate.required.footer');
  // The words are inside the scroll view, so the member can scroll through them...
  expect(within(scroll).getByText(is('appupdate.required.title'))).toBeOnTheScreen();
  expect(within(scroll).getByText(is('appupdate.required.body'))).toBeOnTheScreen();
  // ...and Update is outside it, in the footer below, so it never scrolls away.
  expect(within(footer).getByTestId('appupdate.required.update')).toBeOnTheScreen();
  expect(within(scroll).queryByTestId('appupdate.required.update')).toBeNull();
  expect(within(scroll).queryByTestId('appupdate.required.footer')).toBeNull();
  expect(within(footer).queryByText(is('appupdate.required.body'))).toBeNull();
  // The scroll takes the room the footer leaves.
  expect(scroll).toHaveStyle({ flex: 1 });
  // The title stops at accessibility1, where "Vinsamlegast" still fits a 360 dp
  // phone; the body grows with the member's setting.
  expect(screen.getByTestId('appupdate.required.title').props.maxFontSizeMultiplier).toBe(FONT_SCALE_CAP.accessibility1);
  expect(screen.getByTestId('appupdate.required.body').props.maxFontSizeMultiplier).toBeUndefined();

  await fireEvent.press(within(footer).getByRole('button', { name: is('appupdate.update') }));
  expect(openURL).toHaveBeenCalledWith(MARKET);
});

it('a failed re-check on a return to the foreground lifts the block', async () => {
  // React Native's Jest setup mocks AppState; this test drives its listener.
  const addEventListener = jest.mocked(AppState.addEventListener);
  const own = addEventListener.getMockImplementation();
  const listeners = new Set<(state: AppStateStatus) => void>();
  addEventListener.mockImplementation((_type, listener) => {
    listeners.add(listener as (state: AppStateStatus) => void);
    return { remove: () => void listeners.delete(listener as (state: AppStateStatus) => void) } as NativeEventSubscription;
  });
  try {
    serve('2.6.0', null);
    await render(<AppUpdateHost />);
    await settle();
    expect(screen.getByTestId('appupdate.required')).toBeOnTheScreen();

    api.reset();
    api.on('GET', '/app-version', { kind: 'network-error' });
    await act(async () => [...listeners].forEach((listener) => listener('active')));
    await settle();
    expect(screen.queryByTestId('appupdate.required')).toBeNull();
    expect(screen.queryByTestId('appupdate.available')).toBeNull();
  } finally {
    if (own) addEventListener.mockImplementation(own);
    else addEventListener.mockReset();
  }
});

it('says so when neither link opens', async () => {
  serve('2.6.0', null);
  openURL.mockRejectedValue(new Error('nothing to open it'));
  await render(<AppUpdateHost />);
  await settle();
  await fireEvent.press(screen.getByTestId('appupdate.required.update'));
  await settle();
  expect(screen.getByText(en('appupdate.store_failed'))).toBeOnTheScreen();
});

it('a newer version: "A new version is available", once the launch screen has gone; Not now retires it', async () => {
  useAppStore.setState({ isLoading: true });
  useNavPrefs.setState({ launchTab: null });
  serve(null, '2.6.0');
  await render(<AppUpdateHost />);
  await settle();
  // Decided, but not over the launch screen.
  expect(useAppUpdate.getState().prompt.kind).toBe('available');
  expect(screen.queryByTestId('appupdate.available')).toBeNull();

  // The session is resolved, but launch has not chosen its tab yet: the
  // launch screen is still up (RootNavigator), so still nothing.
  await act(async () => useAppStore.setState({ isLoading: false }));
  expect(screen.queryByTestId('appupdate.available')).toBeNull();

  await act(async () => setLaunchTab('Explore'));
  expect(screen.getByText(en('appupdate.available.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('appupdate.available.body'))).toBeOnTheScreen();
  expect(screen.queryByTestId('appupdate.required')).toBeNull();
  // On screen is not answered: nothing is kept yet.
  expect(await answered()).toBeNull();

  await fireEvent.press(screen.getByTestId('appupdate.available.notNow'));
  await settle();
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
  expect(openURL).not.toHaveBeenCalled();
  expect(await answered()).toBe('2.6.0');
});

it('a soft prompt the member never answered comes back at the next launch', async () => {
  serve(null, '2.6.0');
  const first = await render(<AppUpdateHost />);
  await settle();
  expect(screen.getByTestId('appupdate.available')).toBeOnTheScreen();
  // The app is closed with the prompt still up.
  await first.unmount();
  expect(await answered()).toBeNull();

  resetAppUpdateForTests();
  setAppUpdateDepsForTests({ currentVersion: () => '2.5.6' });
  await render(<AppUpdateHost />);
  await settle();
  expect(screen.getByTestId('appupdate.available')).toBeOnTheScreen();
});

it('back on the soft prompt answers Not now', async () => {
  serve(null, '2.6.0');
  await render(<AppUpdateHost />);
  await settle();
  await fireEvent(screen.getByTestId('appupdate.available'), 'requestClose');
  await settle();
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
  expect(openURL).not.toHaveBeenCalled();
  expect(await answered()).toBe('2.6.0');
});

it('Update on the soft prompt opens the store and retires it too', async () => {
  serve(null, '2.6.0');
  await render(<AppUpdateHost />);
  await settle();
  await fireEvent.press(screen.getByTestId('appupdate.available.update'));
  await settle();
  expect(openURL).toHaveBeenCalledWith(MARKET);
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
  expect(useAppUpdate.getState().prompt.kind).toBe('none');
  expect(await answered()).toBe('2.6.0');
});

it('nothing at all when the check fails or the app is current', async () => {
  api.on('GET', '/app-version', Reply.problem(500, 'internal_error'));
  const view = await render(<AppUpdateHost />);
  await settle();
  expect(screen.queryByTestId('appupdate.required')).toBeNull();
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
  await view.unmount();

  api.reset();
  resetAppUpdateForTests();
  setAppUpdateDepsForTests({ currentVersion: () => '2.6.0' });
  serve('2.6.0', '2.6.0');
  await render(<AppUpdateHost />);
  await settle();
  expect(screen.queryByTestId('appupdate.required')).toBeNull();
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
});

describe('the store links', () => {
  it('goes to the Play Store app for the listing the server names', () => {
    expect(marketUrl(PLAY)).toBe(MARKET);
    expect(marketUrl('https://evil.example/?id=other')).toBe(MARKET);
  });

  it('never throws', async () => {
    await expect(openPlayStore(PLAY, async () => Promise.reject(new Error('no')))).resolves.toBe(false);
  });
});
