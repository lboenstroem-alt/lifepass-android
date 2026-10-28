/**
 * Which language the app speaks when it does not have the profile: the port
 * of iOS AccountLanguageTests (the app-state cases; the error-copy cases are
 * F2's errorFormatter tests).
 *
 * Three holes iOS closed in 2.5.0: sign-up was English on an Icelandic phone
 * (the account language is unknown before sign-in, and the fallback was
 * "en"); an offline profile read at the gym switched an Icelandic member to
 * English; and every error without its own copy was the server's English.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { currentLanguage, deviceLanguage } from '../../i18n';
import { supabase } from '../../supabase/lib/client';
import {
  ACCOUNT_LANGUAGE_KEY,
  deriveLanguage,
  hydrateAccountLanguageForTests,
  resetAppStoreForTests,
  useAppStore,
} from '../appStore';

import { freshStorePerTest, MEMBER_A, phoneLanguage, profileJSON } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

describe('before and without the profile', () => {
  it('signed out, the app speaks the device language', () => {
    expect(store().profile).toBeNull();
    expect(store().language).toBe(deviceLanguage());
    expect(currentLanguage()).toBe(deviceLanguage());
  });

  it('an Icelandic phone is spoken to in Icelandic from the first screen', () => {
    phoneLanguage('is');
    resetAppStoreForTests();
    expect(store().language).toBe('is');
    expect(currentLanguage()).toBe('is');
  });

  it('a language changed in Settings while the app was away is spoken on the return (Android keeps the JS runtime)', async () => {
    phoneLanguage('en');
    resetAppStoreForTests();
    const start = jest.spyOn(supabase.auth, 'startAutoRefresh').mockResolvedValue();
    const stop = jest.spyOn(supabase.auth, 'stopAutoRefresh').mockResolvedValue();
    try {
      await store().bootstrap();
      expect(store().isAuthenticated).toBe(false);
      expect(store().language).toBe('en');
      const onChange = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1] as (state: string) => void;

      onChange('background');
      phoneLanguage('is');
      onChange('active');
      expect(store().language).toBe('is');
      expect(currentLanguage()).toBe('is');
    } finally {
      start.mockRestore();
      stop.mockRestore();
    }
  });

  it('a failed profile read keeps the last known account language', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: 'is' })));
    await store().loadProfile();
    expect(store().language).toBe('is');
    expect(await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY)).toBe('is');

    // The next launch, offline: the stored session keeps the member signed
    // in, and the profile read fails.
    resetAppStoreForTests();
    await hydrateAccountLanguageForTests();
    api.on('GET', '/profile', Reply.problem(503, 'internal_error'));
    useAppStore.setState({ isAuthenticated: true });
    await store().loadProfile();
    expect(store().profile).toBeNull();
    expect(store().language).toBe('is');
    expect(currentLanguage()).toBe('is');
  });

  it("a signed-out phone ignores the last account's language", async () => {
    await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, 'is');
    await hydrateAccountLanguageForTests();
    expect(store().language).toBe(deviceLanguage());
    useAppStore.setState({ isAuthenticated: true });
    expect(store().language).toBe('is');
    expect(currentLanguage()).toBe('is');
    useAppStore.setState({ isAuthenticated: false });
    expect(currentLanguage()).toBe(deviceLanguage());
  });

  it('sign-out forgets the account language', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: 'is' })));
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
    await store().loadProfile();
    await store().handleSignOut();
    expect(store().language).toBe(deviceLanguage());
    expect(await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY)).toBeNull();
  });

  it('a fresh sign-in forgets the cached language (it may be a different member)', async () => {
    await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, 'is');
    await hydrateAccountLanguageForTests();
    api.on('GET', '/profile', Reply.problem(503, 'internal_error'));
    api.on('GET', '/subscriptions', Reply.ok(null));
    await store().handleSignIn(MEMBER_A);
    expect(store().isAuthenticated).toBe(true);
    expect(store().language).toBe(deviceLanguage());
    expect(await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY)).toBeNull();
  });
});

describe('a new account', () => {
  it('records the language it signed up in, once', async () => {
    let locale: string | null = null;
    api.on('GET', '/profile', () => Reply.ok(profileJSON({ locale })));
    api.on('POST', '/profile/locale', (request) => {
      locale = (request.body as { locale: string }).locale;
      return Reply.ok({ locale });
    });
    await store().loadProfile();

    const posts = api.sentAll('/profile/locale', 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ locale: deviceLanguage() });
    expect(store().profile?.locale).toBe(deviceLanguage());

    // Once set, it is never written again.
    await store().loadProfile();
    expect(api.sentAll('/profile/locale', 'POST')).toHaveLength(1);
  });

  it('an Icelandic sign-up stays Icelandic', async () => {
    phoneLanguage('is');
    resetAppStoreForTests();
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: null })));
    api.on('POST', '/profile/locale', (request) => Reply.ok(request.body));
    await store().loadProfile();
    expect(api.sent('/profile/locale', 'POST').body).toEqual({ locale: 'is' });
    expect(store().language).toBe('is');
  });

  it('a failed write is tried again at the next read, and the screens keep their language', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: null })));
    api.on('POST', '/profile/locale', Reply.problem(503, 'internal_error'));
    await store().loadProfile();
    expect(store().profile?.locale).toBeNull();
    expect(store().language).toBe(deviceLanguage());
    await store().loadProfile();
    expect(api.sentAll('/profile/locale', 'POST')).toHaveLength(2);
  });

  it('an account that has a language is left alone', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: 'en' })));
    await store().loadProfile();
    expect(api.requests.every((r) => r.path !== '/profile/locale')).toBe(true);
  });
});

describe('the rule', () => {
  it('profile, then the cache while signed in, then the device', () => {
    const profile = { locale: 'is' } as never;
    expect(deriveLanguage({ profile, isAuthenticated: false, cachedAccountLanguage: 'en' }, 'en')).toBe('is');
    expect(deriveLanguage({ profile: null, isAuthenticated: true, cachedAccountLanguage: 'is' }, 'en')).toBe('is');
    expect(deriveLanguage({ profile: null, isAuthenticated: false, cachedAccountLanguage: 'is' }, 'en')).toBe('en');
    expect(deriveLanguage({ profile: null, isAuthenticated: true, cachedAccountLanguage: null }, 'is')).toBe('is');
    // Any language the app does not speak reads English, as iOS falls back.
    expect(deriveLanguage({ profile: { locale: 'de' } as never, isAuthenticated: true, cachedAccountLanguage: 'is' }, 'is')).toBe('en');
  });
});
