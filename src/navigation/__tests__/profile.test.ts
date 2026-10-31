/**
 * Profile behind the person buttons (iOS 2.4.0): what the buttons say, what
 * opening Profile records, and the one-time "moved" pointer's rules.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { translate } from '../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../lib/analytics';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from '../navPrefs';
import {
  markProfileOpened,
  openProfile,
  planVisitsKey,
  profileOpenedKey,
  shouldShowProfileMovedHint,
} from '../profile';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

describe('the person button', () => {
  // NavigationAccessibilityUITests.profileLabel
  it('says where it goes, in both languages', () => {
    expect(translate('a11y.open_profile', 'en')).toBe('Open profile: bookings and saved');
    expect(translate('a11y.open_profile', 'is')).toBe('Opna prófíl: bókanir og vistað');
  });

  it('opens Profile on Bookings (or the half asked for) and records where from', () => {
    const events: [string, AnalyticsParams][] = [];
    setAnalyticsObserver((event, params) => events.push([event, params]));
    const navigate = jest.fn();
    openProfile({ navigate }, 'explore');
    openProfile({ navigate }, 'favourites', 'saved');
    setAnalyticsObserver(null);
    expect(navigate.mock.calls).toEqual([
      ['Profile', { initialTab: 'bookings' }],
      ['Profile', { initialTab: 'saved' }],
    ]);
    expect(events).toEqual([
      ['profile_opened', { entry: 'explore' }],
      ['profile_opened', { entry: 'favourites' }],
    ]);
  });
});

describe('the one-time pointer', () => {
  it('uses per-member keys, as iOS does', () => {
    expect(profileOpenedKey(MEMBER)).toBe(`nav.profileHint.${MEMBER}.profileOpened`);
    expect(planVisitsKey(MEMBER)).toBe(`nav.profileHint.${MEMBER}.planVisits`);
  });

  it('never shows on a fresh install', async () => {
    expect(await shouldShowProfileMovedHint(MEMBER)).toBe(false);
  });

  it('shows on an install that knew the Profile tab, until the member has opened Profile', async () => {
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    expect(await shouldShowProfileMovedHint(MEMBER)).toBe(true);
    expect(await shouldShowProfileMovedHint(null)).toBe(false);
    await markProfileOpened(MEMBER);
    expect(await shouldShowProfileMovedHint(MEMBER)).toBe(false);
    // Another member on the same phone still gets it.
    expect(await shouldShowProfileMovedHint('3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22')).toBe(true);
  });
});
