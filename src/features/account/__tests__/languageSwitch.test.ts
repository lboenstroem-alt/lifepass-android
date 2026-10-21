/**
 * The language switch's rules (iOS AccountView.setLanguage): nothing is sent
 * without a profile or for the language the account already has; a save
 * posts the locale and re-reads the profile; a failure answers the reason in
 * the language still on screen.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeProfile } from '../../../api/profile';
import { currentLanguage } from '../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { languageChangeNeeded, saveAccountLanguage } from '../languageSwitch';

import { profileJSON } from './members';

stubApiClientPerTest();

beforeEach(() => resetAppStoreForTests());
afterEach(() => resetAppStoreForTests());

describe('languageChangeNeeded', () => {
  it('needs a profile', () => {
    expect(languageChangeNeeded(null, 'is')).toBe(false);
  });

  it('is a no-op for the language the account has', () => {
    expect(languageChangeNeeded({ locale: 'en' }, 'en')).toBe(false);
    expect(languageChangeNeeded({ locale: 'is' }, 'is')).toBe(false);
  });

  it('sends a different language, and any choice for an account with none yet', () => {
    expect(languageChangeNeeded({ locale: 'en' }, 'is')).toBe(true);
    expect(languageChangeNeeded({ locale: null }, 'en')).toBe(true);
  });
});

describe('saveAccountLanguage', () => {
  beforeEach(() => {
    useAppStore.setState({ isLoading: false, isAuthenticated: true, profile: decodeProfile(profileJSON({ locale: 'en' })) });
  });

  it('posts the locale, re-reads the profile, and the app speaks it', async () => {
    api.on('POST', '/profile/locale', Reply.ok({ locale: 'is' }));
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: 'is' })));
    await expect(saveAccountLanguage('is')).resolves.toBeNull();
    expect(api.sent('/profile/locale', 'POST').body).toEqual({ locale: 'is' });
    expect(useAppStore.getState().language).toBe('is');
    expect(currentLanguage()).toBe('is');
  });

  it('a refusal answers its reason in the language on screen, and keeps the language', async () => {
    api.on('POST', '/profile/locale', Reply.fail());
    const reason = await saveAccountLanguage('is');
    expect(reason).toBe('Network error. Please try again.');
    expect(api.sentAll('/profile', 'GET')).toHaveLength(0);
    expect(useAppStore.getState().language).toBe('en');
  });
});
