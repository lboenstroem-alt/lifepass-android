/**
 * The update prompt on screen: the block below the minimum (Update opens
 * Google Play, in Icelandic too, and nothing behind it can be reached), the
 * soft prompt once the launch screen has gone (Not now keeps it away for that
 * version), and nothing at all when the check fails.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import AppUpdateHost from '../AppUpdateHost';
import { marketUrl, openPlayStore } from '../openStore';
import { resetAppUpdateForTests, setAppUpdateDepsForTests, useAppUpdate } from '../updateStore';

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
  useAppStore.setState({ isLoading: false });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
  resetAppUpdateForTests();
  resetAppStoreForTests();
});

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
  serve(null, '2.6.0');
  await render(<AppUpdateHost />);
  await settle();
  // Decided, but not over the launch screen.
  expect(useAppUpdate.getState().prompt.kind).toBe('available');
  expect(screen.queryByTestId('appupdate.available')).toBeNull();

  await act(async () => useAppStore.setState({ isLoading: false }));
  expect(screen.getByText(en('appupdate.available.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('appupdate.available.body'))).toBeOnTheScreen();
  expect(screen.queryByTestId('appupdate.required')).toBeNull();

  await fireEvent.press(screen.getByTestId('appupdate.available.notNow'));
  await settle();
  expect(screen.queryByTestId('appupdate.available')).toBeNull();
  expect(openURL).not.toHaveBeenCalled();
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
