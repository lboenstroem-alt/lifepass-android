/**
 * Profile (bookings and saved) behind the Home avatar and every top-bar
 * person button; Account one tap further, behind Profile's gear (iOS 2.4.0:
 * Plan took the Profile tab's place and NOTHING was removed).
 *
 * `openProfile` is what every person button calls, so each one fires the
 * same `profile_opened {entry}` iOS does. The one-time "your bookings are
 * here now" pointer keys live here too, beside the migration that earns it
 * (src/app/launchTab.ts): HOME-1 draws the callout, PLAN-1 the Plan hint.
 *
 * The pointer keys are per member, so two accounts on one phone do not
 * inherit each other's "already seen it". They are not health or account
 * data and stay on the phone at sign-out (iOS keeps them).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { track } from '../lib/analytics';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from './navPrefs';
import type { ProfileTab, SharedRoutes } from './types';

/** Where Profile was opened from (iOS `profile_opened.entry`, `ios-ux.md` 1.6). */
export type ProfileEntry = 'home_avatar' | 'explore' | 'scan' | 'favourites';

/** Anything that can push a shared route: a screen's own `navigation`. */
export interface ProfileNavigator {
  navigate(name: 'Profile', params: SharedRoutes['Profile']): void;
}

/** Opens Profile on its Bookings half (or `initialTab`) and records where from. */
export function openProfile(navigation: ProfileNavigator, entry: ProfileEntry, initialTab: ProfileTab = 'bookings'): void {
  track('profile_opened', { entry });
  navigation.navigate('Profile', { initialTab });
}

/** The member has been to Profile from Home: the moved pointer retires (iOS key). */
export function profileOpenedKey(profileId: string): string {
  return `nav.profileHint.${profileId}.profileOpened`;
}

/** How many times Plan has shown its bookings hint to this member (iOS key; PLAN-1). */
export function planVisitsKey(profileId: string): string {
  return `nav.profileHint.${profileId}.planVisits`;
}

/** Records that this member has found Profile (Home's avatar or a tap on the pointer). Never throws. */
export async function markProfileOpened(profileId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(profileOpenedKey(profileId), 'true');
  } catch {
    // The pointer may show once more; nothing worse.
  }
}

/**
 * Whether Home shows the one-time pointer under the avatar: only on an
 * install that knew Profile as a tab, and only until this member has opened
 * Profile once (iOS `evaluateProfileMovedHint`).
 */
export async function shouldShowProfileMovedHint(profileId: string | null | undefined): Promise<boolean> {
  if (!profileId) return false;
  try {
    const [upgraded, opened] = await Promise.all([
      AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY),
      AsyncStorage.getItem(profileOpenedKey(profileId)),
    ]);
    return upgraded === 'true' && opened !== 'true';
  } catch {
    return false;
  }
}
