/**
 * Notifications at startup (src/notifications/register.ts): the account
 * language is kept under `health.reminders.lastLanguage` (iOS
 * `HealthReminderService.sync`), so a background job written away from the
 * app store speaks it; the phone's language never overwrites it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { decodeProfile } from '../../api/profile';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { NOTIFICATION_LANGUAGE_KEY, notificationLanguage } from '../channels';
import { accountLanguage } from '../register';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

function profile(locale: string | null) {
  return decodeProfile({ id: MEMBER, email: 'member@example.com', locale, kennitalaVerified: true, marketingConsent: false });
}

async function stored(): Promise<string | null> {
  // The write is fire and forget; let it land.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return AsyncStorage.getItem(NOTIFICATION_LANGUAGE_KEY);
}

afterEach(() => resetAppStoreForTests());

it("keeps the account's language, follows a change, and never writes the phone's", async () => {
  // Signed out (as a background run starts): the phone's language is not the account's.
  useAppStore.setState({ isAuthenticated: false, profile: null, cachedAccountLanguage: null });
  expect(await stored()).toBeNull();

  // Signed in, the profile not read yet, no cached account language: still nothing.
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: null, cachedAccountLanguage: null });
  expect(await stored()).toBeNull();

  useAppStore.setState({ cachedAccountLanguage: 'is' });
  expect(await stored()).toBe('is');

  useAppStore.setState({ profile: profile('en') });
  expect(await stored()).toBe('en');
  await expect(notificationLanguage()).resolves.toBe('en');

  // A sign-out leaves the last account language for the next background run.
  useAppStore.setState({ isAuthenticated: false, userId: null, profile: null, cachedAccountLanguage: null });
  expect(await stored()).toBe('en');
});

it('the account language: the profile first, then the cached one, nobody signed in is none', () => {
  expect(accountLanguage({ isAuthenticated: true, profile: profile('is'), cachedAccountLanguage: 'en' })).toBe('is');
  expect(accountLanguage({ isAuthenticated: true, profile: profile(null), cachedAccountLanguage: 'is' })).toBe('is');
  expect(accountLanguage({ isAuthenticated: true, profile: null, cachedAccountLanguage: null })).toBeNull();
  expect(accountLanguage({ isAuthenticated: false, profile: profile('is'), cachedAccountLanguage: 'is' })).toBeNull();
});
