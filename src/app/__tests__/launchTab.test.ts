/**
 * The cold-launch tab and the one-time tab migration. Ports iOS
 * ExploreLaunchTests (LifePassTests/VenueBrowseOrderTests.swift) and the
 * `nav.tabs.v2` rules of LifePassApp.migrateTabSelection.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetIntentStoreForTests, useIntentStore } from '../../stores/intentStore';
import { MEMBER_A, storeSession } from '../../stores/__tests__/storeHarness';
import { MAIN_TABS } from '../../navigation/types';
import {
  applyColdLaunchTab,
  coldLaunchTab,
  FIRST_BUILD_COACH_SESSIONS_KEY,
  hasResumableWorkoutAtLaunch,
  LAUNCH_TAB,
  migrateTabSelection,
  prepareLaunchTab,
  readStoredTab,
  TABS_V2_KEY,
  UPGRADED_FROM_PROFILE_TAB_KEY,
} from '../launchTab';
import { SELECTED_TAB_KEY } from '../../navigation/navPrefs';

const mockResumable = jest.fn(async (_profileId?: string): Promise<{ sessionId: string | null } | null> => null);
jest.mock('../../features/runner', () => ({
  resumableWorkout: (profileId?: string) => mockResumable(profileId),
}));

beforeEach(() => {
  resetIntentStoreForTests();
  mockResumable.mockReset();
  mockResumable.mockResolvedValue(null);
});

/** Lets the fire-and-forget storage write land. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ExploreLaunchTests', () => {
  // testAColdLaunchOpensOnExplore
  it('a cold launch opens on Explore, whatever tab was left', () => {
    for (const stored of MAIN_TABS) {
      expect(coldLaunchTab(stored, false)).toBe(LAUNCH_TAB);
    }
    expect(LAUNCH_TAB).toBe('Explore');
    expect(SELECTED_TAB_KEY).toBe('selectedTab');
  });

  // testAWorkoutInProgressKeepsTheStoredTab
  it('a workout in progress keeps the stored tab', () => {
    expect(coldLaunchTab('Plan', true)).toBe('Plan');
    expect(coldLaunchTab('Home', true)).toBe('Home');
  });

  // testTheResumableWorkoutCheckReadsTheRunnerFile (the launch half: RUN-1 owns the file)
  it('the workout check asks the runner for the stored member, and nothing without one', async () => {
    expect(await hasResumableWorkoutAtLaunch(null)).toBe(false);
    expect(mockResumable).not.toHaveBeenCalled();

    expect(await hasResumableWorkoutAtLaunch(MEMBER_A)).toBe(false);
    expect(mockResumable).toHaveBeenCalledWith(MEMBER_A);

    mockResumable.mockResolvedValueOnce({ sessionId: 's-1' });
    expect(await hasResumableWorkoutAtLaunch(MEMBER_A)).toBe(true);

    // A runner file that exists but could not be read counts: when in doubt keep the tab.
    mockResumable.mockResolvedValueOnce({ sessionId: null });
    expect(await hasResumableWorkoutAtLaunch(MEMBER_A)).toBe(true);
    mockResumable.mockRejectedValueOnce(new Error('locked'));
    expect(await hasResumableWorkoutAtLaunch(MEMBER_A)).toBe(true);
  });

  it('launch writes Explore over the stored tab and opens Explore with its filters, once', async () => {
    await AsyncStorage.setItem(SELECTED_TAB_KEY, 'Plan');
    await storeSession(MEMBER_A);
    expect(await prepareLaunchTab()).toBe('Explore');
    await flush();
    expect(await AsyncStorage.getItem(SELECTED_TAB_KEY)).toBe('Explore');
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(true);
  });

  it('a resumable workout of the stored member keeps Plan, and Explore opens no filters', async () => {
    await AsyncStorage.setItem(SELECTED_TAB_KEY, 'Plan');
    await storeSession(MEMBER_A);
    mockResumable.mockResolvedValue({ sessionId: 's-1' });
    expect(await prepareLaunchTab()).toBe('Plan');
    expect(mockResumable).toHaveBeenCalledWith(MEMBER_A);
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);
  });

  it('no stored member means no workout and Explore', async () => {
    await AsyncStorage.setItem(SELECTED_TAB_KEY, 'Plan');
    mockResumable.mockResolvedValue({ sessionId: 's-1' });
    expect(await applyColdLaunchTab()).toBe('Explore');
    expect(mockResumable).not.toHaveBeenCalled();
  });

  it('an unknown stored tab reads as Home', async () => {
    await AsyncStorage.setItem(SELECTED_TAB_KEY, 'Bookings');
    expect(await readStoredTab()).toBe('Home');
  });
});

describe('the nav.tabs.v2 migration', () => {
  it('a fresh install is never told about a move it did not live through', async () => {
    await migrateTabSelection();
    expect(await AsyncStorage.getItem(TABS_V2_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY)).toBeNull();
  });

  it('an install from the first build (a member on the phone) knew the Profile tab', async () => {
    await storeSession(MEMBER_A);
    await migrateTabSelection();
    expect(await AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY)).toBe('true');
  });

  it('so did one that left Coach chats behind', async () => {
    await AsyncStorage.setItem(FIRST_BUILD_COACH_SESSIONS_KEY, '[]');
    await migrateTabSelection();
    expect(await AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY)).toBe('true');
  });

  it('runs once: a member who signs in later on a fresh install is not an upgrade', async () => {
    await migrateTabSelection();
    await storeSession(MEMBER_A);
    await migrateTabSelection();
    expect(await AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY)).toBeNull();
  });

  it('puts a stored tab that is not this build’s back to Home', async () => {
    await AsyncStorage.setItem(SELECTED_TAB_KEY, '4');
    await migrateTabSelection();
    expect(await AsyncStorage.getItem(SELECTED_TAB_KEY)).toBe('Home');
  });
});
