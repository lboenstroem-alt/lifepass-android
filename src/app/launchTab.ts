/**
 * The tab a cold launch opens on, and the one-time tab migration: the Android
 * port of iOS `LaunchTab` and `LifePassApp.migrateTabSelection`
 * (App/LifePassApp.swift, 2.5.4).
 *
 * THE RULE. A cold launch opens on Explore, with the venues and the filters
 * open, once (`exploreLaunchPresentation`), instead of whichever tab the
 * member last left. The one exception is a workout in progress: then the
 * stored tab stays (Plan, where the Resume row is). Deep links and
 * notifications route after this, as they always did, and anything that
 * takes the member elsewhere first cancels the Explore presentation (the
 * intent store keeps that rule).
 *
 * The workout check reads the session STORED on the phone, not the app
 * store's: launch decides the tab before the session is restored. No stored
 * session means no member and no workout, so Explore (iOS reads
 * `auth.currentSession` the same way, and opens on Explore without one).
 *
 * THE MIGRATION (`nav.tabs.v2`). The first Android build had a Profile tab
 * where Plan is now. An install that KNEW that tab earns the one-time "your
 * bookings and saved places are here now" pointer on Home
 * (`nav.upgradedFromProfileTab`); a fresh install is never told about a move
 * it did not live through. The first build stored no tab, so the sign is that
 * it left a member signed in, or Coach chats, on the phone: this build sets
 * `nav.tabs.v2` at its very first launch, before anyone can sign in, so a
 * session already there on that launch came from the first build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FIXTURE_PROFILE_ID, requestedFixtureState } from '../dev/fixtureSession';
import { fixtureArg, hasFixture } from '../dev/fixtures';
import { resumableWorkout } from '../features/runner';
import { readStoredSession } from '../lib/secureSessionStorage';
import {
  hydrateNavPrefs,
  parseStoredTab,
  persistSelectedTab,
  PLAN_TAB_SEEN_KEY,
  SELECTED_TAB_KEY,
  TABS_V2_KEY,
  UPGRADED_FROM_PROFILE_TAB_KEY,
} from '../navigation/navPrefs';
import { profileOpenedKey } from '../navigation/profile';
import { MAIN_TABS, type MainTab } from '../navigation/types';
import { routeFromData, useNotificationRouter } from './notificationRouter';
import { useIntentStore } from '../stores/intentStore';
import { SUPABASE_STORAGE_KEY } from '../supabase/lib/client';

export { TABS_V2_KEY, UPGRADED_FROM_PROFILE_TAB_KEY };

/** Where the first Android build kept its Coach chats (a sign it was used). */
export const FIRST_BUILD_COACH_SESSIONS_KEY = 'coach.sessions.v1';

/** The tab a cold launch opens on (iOS `LaunchTab.explore`). */
export const LAUNCH_TAB: MainTab = 'Explore';

/** iOS `LaunchTab.coldLaunchTab`: Explore, unless a workout in progress keeps the stored tab. */
export function coldLaunchTab(stored: MainTab, hasResumableWorkout: boolean): MainTab {
  return hasResumableWorkout ? stored : LAUNCH_TAB;
}

async function readFlag(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === 'true';
  } catch {
    return false;
  }
}

async function storedMemberId(): Promise<string | null> {
  const session = await readStoredSession(SUPABASE_STORAGE_KEY);
  const id = session?.user.id;
  return typeof id === 'string' && id.length > 0 ? id.toLowerCase() : null;
}

/**
 * One-time, before the first screen (iOS runs it in `App.init`). Sets
 * `nav.upgradedFromProfileTab` for an install from the first build, then
 * marks itself done. Never throws.
 */
export async function migrateTabSelection(): Promise<void> {
  if (await readFlag(TABS_V2_KEY)) return;
  try {
    let knewProfileTab = (await storedMemberId().catch(() => null)) !== null;
    if (!knewProfileTab) {
      knewProfileTab = (await AsyncStorage.getItem(FIRST_BUILD_COACH_SESSIONS_KEY)) !== null;
    }
    // A stored tab that is not one of this build's goes back to Home (iOS
    // resets a stored Profile tab, so a relaunch never lands on Plan's paywall).
    const raw = await AsyncStorage.getItem(SELECTED_TAB_KEY);
    if (raw !== null && parseStoredTab(raw) === null) await AsyncStorage.setItem(SELECTED_TAB_KEY, 'Home');
    // Not "a stored tab" as on iOS: the first build never stored one, so a
    // stored tab can only be this build's own.
    if (knewProfileTab) await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    await AsyncStorage.setItem(TABS_V2_KEY, 'true');
  } catch {
    // Tried again at the next launch; the pointer is the only thing at stake.
  }
}

/** The stored tab (Home when none or unknown). */
export async function readStoredTab(): Promise<MainTab> {
  try {
    return parseStoredTab(await AsyncStorage.getItem(SELECTED_TAB_KEY)) ?? 'Home';
  } catch {
    return 'Home';
  }
}

/**
 * iOS `LaunchTab.hasResumableWorkout`: the runner file of the member whose
 * session is stored. A file that exists but cannot be read counts (the
 * runner contract answers `sessionId: null`), so the stored tab is kept when
 * in doubt. No stored member: false.
 */
export async function hasResumableWorkoutAtLaunch(profileId: string | null): Promise<boolean> {
  if (!profileId) return false;
  try {
    return (await resumableWorkout(profileId)) !== null;
  } catch {
    // The check itself failed: in doubt, keep the stored tab.
    return true;
  }
}

/** Writes the cold-launch tab and returns it (iOS `applyColdLaunchTab`). Never throws. */
export async function applyColdLaunchTab(): Promise<MainTab> {
  const [stored, memberId] = await Promise.all([readStoredTab(), storedMemberId().catch(() => null)]);
  const tab = coldLaunchTab(stored, await hasResumableWorkoutAtLaunch(memberId));
  persistSelectedTab(tab);
  return tab;
}

/**
 * Development fixtures only (iOS `ScreenshotFixtures.applyLaunchDefaults`):
 * a run that stands up a fixture member may ask for a tab (`tab=0..4`, iOS
 * indices), the moved-Profile pointer (`profileHint`), the Plan dot
 * (`planDot`) and a tapped notification (`notification=plan.checkin`). The
 * migration counts as done, or it would reset the tab the run asked for.
 * Returns the tab asked for, or null. Does nothing in a release build.
 */
export async function applyFixtureLaunchDefaults(): Promise<MainTab | null> {
  if (!__DEV__ || requestedFixtureState() === null) return null;
  await AsyncStorage.multiSet([
    [TABS_V2_KEY, 'true'],
    [UPGRADED_FROM_PROFILE_TAB_KEY, hasFixture('profileHint') ? 'true' : 'false'],
    [PLAN_TAB_SEEN_KEY, hasFixture('planDot') ? 'false' : 'true'],
  ]);
  await AsyncStorage.removeItem(profileOpenedKey(FIXTURE_PROFILE_ID));
  const route = routeFromData({ route: fixtureArg('notification') });
  if (route) useNotificationRouter.setState({ pending: route });
  const raw = fixtureArg('tab');
  const tab = raw !== null && /^[0-4]$/.test(raw) ? (MAIN_TABS[Number(raw)] ?? null) : null;
  if (tab) persistSelectedTab(tab);
  return tab;
}

/**
 * Everything launch decides before the first signed-in screen: the migration,
 * then the tab (a development fixture's tab wins, as on iOS), the tab bar's
 * stored prefs, then (on Explore) the one-time filter presentation. Returns
 * the tab the tabs navigator opens on.
 */
export async function prepareLaunchTab(): Promise<MainTab> {
  await migrateTabSelection();
  const coldTab = await applyColdLaunchTab();
  const tab = (await applyFixtureLaunchDefaults().catch(() => null)) ?? coldTab;
  await hydrateNavPrefs();
  useIntentStore.getState().setExploreLaunchPresentation(tab === LAUNCH_TAB);
  return tab;
}
