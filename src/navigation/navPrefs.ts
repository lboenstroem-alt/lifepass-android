/**
 * The tab bar's own memory on this phone (iOS `@AppStorage` in MainTabView):
 * whether the Plan tab still carries its "new" dot, and the tab the member
 * last left (read only by the launch rule, src/app/launchTab.ts).
 *
 * Neither is the member's data: a tab and "has seen the Plan tab" say nothing
 * about anyone, so sign-out leaves them, as iOS does.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { MAIN_TABS, type MainTab } from './types';

/** The Plan tab was opened once on this phone: its dot is gone for good (iOS key). */
export const PLAN_TAB_SEEN_KEY = 'nav.planTabSeen';

/** The tab the member last left (iOS `LaunchTab.storageKey`); Android stores the tab's name. */
export const SELECTED_TAB_KEY = 'selectedTab';

/** The one-time tab migration ran on this install (iOS key; src/app/launchTab.ts). */
export const TABS_V2_KEY = 'nav.tabs.v2';

/** This install knew Profile as a tab: Home's one-time pointer may show (iOS key). */
export const UPGRADED_FROM_PROFILE_TAB_KEY = 'nav.upgradedFromProfileTab';

interface NavPrefsState {
  /** False until the stored value is read: the dot never flashes on for a member who already saw Plan. */
  readonly hydrated: boolean;
  readonly planTabSeen: boolean;
  /** The tab this launch opens on, once launch has decided it (src/app/launchTab.ts); null before. */
  readonly launchTab: MainTab | null;
  /**
   * The tab on screen, for this process: the tabs open on it again after a
   * sign-out and sign-in (iOS keeps `selectedTab`), not on the launch tab.
   */
  readonly currentTab: MainTab | null;
}

const initialState: NavPrefsState = { hydrated: false, planTabSeen: false, launchTab: null, currentTab: null };

export const useNavPrefs = create<NavPrefsState>()(() => initialState);

/** Launch decided its tab. */
export function setLaunchTab(tab: MainTab): void {
  useNavPrefs.setState({ launchTab: tab });
}

/** The tab the signed-in tabs should open on now: the one last on screen, else the launch tab. */
export function initialTabForShell(): MainTab {
  const { currentTab, launchTab } = useNavPrefs.getState();
  return currentTab ?? launchTab ?? 'Explore';
}

/** Reads the stored prefs once at launch. Never throws. */
export async function hydrateNavPrefs(): Promise<void> {
  let seen = false;
  try {
    seen = (await AsyncStorage.getItem(PLAN_TAB_SEEN_KEY)) === 'true';
  } catch {
    seen = false;
  }
  // A visit this run (before the read answered) wins over an older "not seen".
  useNavPrefs.setState((state) => ({ hydrated: true, planTabSeen: state.planTabSeen || seen }));
}

/** The member opened Plan: the dot goes, on this phone, for good. */
export function markPlanTabSeen(): void {
  if (useNavPrefs.getState().planTabSeen) return;
  useNavPrefs.setState({ planTabSeen: true });
  AsyncStorage.setItem(PLAN_TAB_SEEN_KEY, 'true').catch(() => undefined);
}

/** A stored tab name, or null when there is none or it is not a tab of this build. */
export function parseStoredTab(raw: string | null | undefined): MainTab | null {
  if (!raw) return null;
  return (MAIN_TABS as readonly string[]).includes(raw) ? (raw as MainTab) : null;
}

/** Remembers the tab the member is on (the launch rule reads it). Never throws. */
export function persistSelectedTab(tab: MainTab): void {
  AsyncStorage.setItem(SELECTED_TAB_KEY, tab).catch(() => undefined);
}

/** The tabs shell is showing `tab`: remembered for this process and on the phone. */
export function noteSelectedTab(tab: MainTab): void {
  if (useNavPrefs.getState().currentTab !== tab) useNavPrefs.setState({ currentTab: tab });
  persistSelectedTab(tab);
}

/** Back to a fresh process (tests). */
export function resetNavPrefsForTests(): void {
  useNavPrefs.setState(initialState);
}
