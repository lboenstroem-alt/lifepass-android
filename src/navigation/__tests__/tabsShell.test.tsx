/**
 * The signed-in shell (iOS MainTabView) with the app's real navigators: the
 * launch tab and its one-time Explore presentation, parked tabs, notification
 * taps, check-in links, `openProfile` and the Profile route, the first
 * build's route names, the tab bar's height, and every route of plan 3.0.2
 * in place.
 *
 * The person buttons themselves are their owners' screens (HOME-1's avatar,
 * F5's top bar): this file drives `openProfile` from a stand-in screen, so it
 * tests the route and the analytics, not that a real button calls it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { handleNotificationResponse, useNotificationRouter } from '../../app/notificationRouter';
import { setAnalyticsObserver, type AnalyticsParams } from '../../lib/analytics';
import { useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { TAB_BAR_HEIGHT } from '../CustomTabBar';
import { navigateInCurrentTab, openRootModal } from '../navigationRef';
import { SELECTED_TAB_KEY, useNavPrefs } from '../navPrefs';
import { SHARED_ROUTE_NAMES } from '../sharedRoutes';
import { MAIN_TABS, TAB_ROOT_SCREEN, type RootModalName, type SharedRouteName } from '../types';
import { currentRouteName, currentTab, navigationRef, renderShell, signedIn } from './shellHarness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */

// A tab screen that calls `openProfile` as a person button does.
jest.mock('../../screens/home/HomeScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useNavigation: mockUseNavigation } = require('@react-navigation/native');
  const { openProfile: mockOpenProfile } = require('../profile');
  function Home() {
    const navigation = mockUseNavigation();
    return (
      <MockPressable accessibilityRole="button" onPress={() => mockOpenProfile(navigation, 'home_avatar')}>
        <MockText>Open profile from a tab screen</MockText>
      </MockPressable>
    );
  }
  return { __esModule: true, default: Home };
});
// Explore takes the launch presentation on appear, as EXPL-1's screen does (iOS SearchMapView.onAppear).
jest.mock('../../screens/explore/ExploreScreen', () => {
  const { Text: MockText } = require('react-native');
  const { useState: mockUseState } = require('react');
  const { useIntentStore: mockIntentStore } = require('../../stores/intentStore');
  function Explore() {
    const [filtersOpen] = mockUseState(() => mockIntentStore.getState().takeExploreLaunchPresentation());
    return <MockText>{filtersOpen ? 'Explore, filters open' : 'Explore, filters closed'}</MockText>;
  }
  return { __esModule: true, default: Explore };
});
// A tab screen that pads above the bar.
jest.mock('../../screens/coach/CoachScreen', () => {
  const { Text: MockText } = require('react-native');
  const { useBottomTabBarHeight: mockTabBarHeight } = require('@react-navigation/bottom-tabs');
  function Coach() {
    return <MockText>{`Coach, padded ${mockTabBarHeight()}`}</MockText>;
  }
  return { __esModule: true, default: Coach };
});
jest.mock('../../screens/checkin/CheckInScreen', () => require('./standIn').standInScreen('CheckIn'));
jest.mock('../../screens/bookings/BookingsScreen', () => require('./standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('./standIn').standInScreen('LegacyAccount'));
jest.mock('../../screens/account/TopUpScreen', () => require('./standIn').standInScreen('TopUp'));
// A venue page as the first build drew it: its walk-in bar sends 'CheckIn' to the tab navigator.
// (VENUE-1's page pushes ScanPushed itself; this keeps the legacy name's translation tested.)
jest.mock('../../features/venue/VenueDetailScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useNavigation: mockUseNavigation } = require('@react-navigation/native');
  function LegacyVenue() {
    const navigation = mockUseNavigation();
    return (
      <MockPressable accessibilityRole="button" onPress={() => navigation.getParent()?.navigate('CheckIn' as never)}>
        <MockText>Scan the QR code</MockText>
      </MockPressable>
    );
  }
  return { __esModule: true, default: LegacyVenue };
});
jest.mock('../../screens/booking/BookingFlowScreen', () => require('./standIn').standInScreen('LegacyBooking'));
jest.mock('../../features/auth/screens/OnboardingScreen', () => require('./standIn').standInScreen('Onboarding'));
jest.mock('../../features/auth/screens/LoginScreen', () => require('./standIn').standInScreen('Login'));
jest.mock('../../features/auth/screens/SignUpScreen', () => require('./standIn').standInScreen('SignUp'));
jest.mock('../../components/KenniVerificationModal', () => {
  const { Text: MockText } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible }: { visible: boolean }) => (visible ? <MockText>Kenni sheet</MockText> : null),
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** `navigate` as the first build's screens call it: by a name no navigator has. */
const navigateLegacy = navigationRef.navigate as unknown as (name: string, params?: object) => void;

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

function tapNotification(route: string, extra: Record<string, unknown> = {}) {
  handleNotificationResponse({
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: Date.now(),
      request: { identifier: `n-${route}-${Math.random()}`, content: { data: { route, ...extra } }, trigger: null },
    },
  } as never);
}

const events: [string, AnalyticsParams][] = [];
beforeEach(() => {
  events.length = 0;
  setAnalyticsObserver((event, params) => events.push([event, params]));
});
afterEach(() => setAnalyticsObserver(null));

/** Launch decided Explore and turned its one-time filter presentation on. */
function launchedOntoExplore(): void {
  signedIn('Explore');
  useIntentStore.getState().setExploreLaunchPresentation(true);
}

describe('the launch tab (ExploreLaunchTests)', () => {
  it('a cold launch opens on Explore, with the filters open', async () => {
    launchedOntoExplore();
    await renderShell();
    expect(currentTab()).toBe('Explore');
    expect(screen.getByRole('tab', { name: 'Explore' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
    expect(screen.getByText('Explore, filters open')).toBeOnTheScreen();
  });

  it('a resumable workout keeps the tab it was left on', async () => {
    signedIn('Plan');
    await renderShell();
    expect(currentTab()).toBe('Plan');
  });

  it('after a sign-out and a sign-in the tabs open where the member last was, not on the launch tab', async () => {
    signedIn('Explore');
    await renderShell();
    await fireEvent.press(screen.getByRole('tab', { name: 'Coach' }));
    await act(async () => useAppStore.setState({ isAuthenticated: false }));
    expect(screen.getByText('Onboarding screen')).toBeOnTheScreen();
    await act(async () => useAppStore.setState({ isAuthenticated: true }));
    expect(currentTab()).toBe('Coach');
  });
});

describe('a parked tab', () => {
  it('is performed and cleared', async () => {
    signedIn();
    await renderShell();
    await act(async () => useIntentStore.getState().requestTab('Home'));
    expect(currentTab()).toBe('Home');
    expect(useIntentStore.getState().pendingTab).toBeNull();
  });

  it('asking for Plan while on Plan pops Plan back to its first screen', async () => {
    signedIn('Plan');
    await renderShell();
    await act(async () => {
      navigateInCurrentTab('Measurements');
    });
    expect(currentRouteName()).toBe('Measurements');
    await act(async () => useIntentStore.getState().requestTab('Plan'));
    expect(currentRouteName()).toBe('PlanMain');
  });

  it('one parked before the tabs existed is performed when they appear', async () => {
    signedIn();
    useIntentStore.getState().requestTab('Coach');
    await renderShell();
    expect(currentTab()).toBe('Coach');
  });
});

describe('a notification tap', () => {
  it('on a cold launch opens Plan with its action, not Explore, and Explore never opens its filters by itself', async () => {
    launchedOntoExplore();
    tapNotification('plan.checkin');
    await renderShell();
    expect(currentTab()).toBe('Plan');
    expect(useIntentStore.getState().takePlanAction()?.action).toEqual({ kind: 'openWeeklyCheckIn' });
    // iOS testANotificationStillRoutesFromALaunchOntoExplore.
    expect(screen.queryByText(/^Explore, filters/, { includeHiddenElements: true })).toBeNull();
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);
    await act(async () => useIntentStore.getState().requestTab('Explore'));
    expect(screen.getByText('Explore, filters closed')).toBeOnTheScreen();
  });

  it('while the app runs takes the member to Plan, at its root', async () => {
    signedIn('Plan');
    await renderShell();
    await act(async () => {
      navigateInCurrentTab('Drafts');
    });
    await act(async () => tapNotification('plan'));
    expect(currentRouteName()).toBe('PlanMain');
  });

  it('arriving while signed out is dropped, not performed after sign-in', async () => {
    signedIn();
    useAppStore.setState({ isAuthenticated: false });
    await renderShell();
    await act(async () => tapNotification('plan.feedback', { reportId: 'r-1' }));
    // The tabs are not up: the route waits only until they are, and a
    // signed-out member never gets there with it.
    await act(async () => useAppStore.setState({ isAuthenticated: true }));
    expect(useNotificationRouter.getState().pending).toBeNull();
    expect(currentTab()).toBe('Explore');
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();
  });
});

describe('a check-in link', () => {
  it('switches to Scan and retracts the Kenni nudge without dismissing it', async () => {
    signedIn();
    useAppStore.setState({ pendingKennitalaPrompt: true });
    await renderShell();
    expect(screen.getByText('Kenni sheet')).toBeOnTheScreen();
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    expect(currentTab()).toBe('Scan');
    expect(screen.queryByText('Kenni sheet')).toBeNull();
    expect(await AsyncStorage.getItem('kennitalaPromptDismissed')).toBeNull();
  });

  it('a second link to a venue still parked brings Scan forward again', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    expect(currentTab()).toBe('Scan');
    await fireEvent.press(screen.getByRole('tab', { name: 'Explore' }));
    expect(currentTab()).toBe('Explore');
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    expect(currentTab()).toBe('Scan');
  });

  it('outranks everything at a cold launch, a notification included', async () => {
    launchedOntoExplore();
    tapNotification('plan');
    useIntentStore.getState().parkScanVenue(VENUE);
    await renderShell();
    expect(currentTab()).toBe('Scan');
    // Parked, for the Scan screen to ask about: never consumed by the shell.
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
    // Explore was never drawn on the way.
    expect(screen.queryByText(/^Explore, filters/, { includeHiddenElements: true })).toBeNull();
  });
});

describe('the tab on screen', () => {
  it('is remembered, and the Plan dot retires at the first visit', async () => {
    signedIn();
    await renderShell();
    expect(useNavPrefs.getState().planTabSeen).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan' }));
    expect(useNavPrefs.getState().planTabSeen).toBe(true);
    await act(async () => undefined);
    expect(await AsyncStorage.getItem(SELECTED_TAB_KEY)).toBe('Plan');
    expect(await AsyncStorage.getItem('nav.planTabSeen')).toBe('true');
  });
});

describe('the tab bar height', () => {
  it('a tab screen pads by the real bar (76 plus the inset), and by nothing while a page hides the bar', async () => {
    signedIn('Coach');
    await renderShell();
    // The test's safe area has no bottom inset.
    expect(screen.getByText(`Coach, padded ${TAB_BAR_HEIGHT}`)).toBeOnTheScreen();
    await act(async () => {
      navigateInCurrentTab('BookingFlow', { venueId: VENUE, activity: { id: 'a-1', name: 'Swim', provider: null } });
    });
    // The tab's first screen is under the page (hidden from TalkBack), still mounted.
    expect(screen.getByText('Coach, padded 0', { includeHiddenElements: true })).toBeOnTheScreen();
    await act(async () => navigationRef.goBack());
    expect(screen.getByText(`Coach, padded ${TAB_BAR_HEIGHT}`)).toBeOnTheScreen();
  });
});

describe('openProfile and the Profile route', () => {
  it('opens Profile on Bookings in the tab it is called from, and says where from', async () => {
    signedIn('Home');
    await renderShell();
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile from a tab screen' }));
    expect(currentTab()).toBe('Home');
    expect(currentRouteName()).toBe('Profile');
    expect(screen.getByTestId('params.Library')).toHaveTextContent('{"initialTab":"bookings"}');
    // The tab bar stays, as an iOS push does.
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
    expect(events).toContainEqual(['profile_opened', { entry: 'home_avatar' }]);
  });
});

describe("the first build's route names", () => {
  it('its Profile tab is Profile on the tab you are on', async () => {
    signedIn('Coach');
    await renderShell();
    await act(async () => {
      navigateLegacy('Bookings', { screen: 'BookingsMain', params: { initialTab: 'saved' } });
    });
    expect(currentTab()).toBe('Coach');
    expect(currentRouteName()).toBe('Profile');
    expect(screen.getByTestId('params.Library')).toHaveTextContent('{"initialTab":"saved"}');
  });

  it('its top-up page is the Plans modal', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      navigateLegacy('TopUp');
    });
    expect(currentRouteName()).toBe('Plans');
    expect(screen.getByText('TopUp screen')).toBeOnTheScreen();
  });

  it('its Check-in tab is Scan', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      navigateLegacy('CheckIn');
    });
    expect(currentTab()).toBe('Scan');
  });

  it("its venue page's walk-in scan is the scanner pushed on the venue's stack, back to the venue", async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      navigateInCurrentTab('VenueDetail', { venueId: VENUE });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Scan the QR code' }));
    expect(currentTab()).toBe('Explore');
    expect(currentRouteName()).toBe('ScanPushed');
    await act(async () => navigationRef.goBack());
    expect(currentRouteName()).toBe('VenueDetail');
  });
});

describe('every route of plan 3.0.2', () => {
  const sharedRoutes: SharedRouteName[] = [
    'Profile',
    'Account',
    'Receipts',
    'PlanUsage',
    'VenueDetail',
    'VenueReviews',
    'AttractionDetail',
    'BookingFlow',
    'ScanPushed',
    'BodyAndGoals',
    'Measurements',
    'HealthConnectDetail',
    'Diary',
    'MealHistory',
    'WorkoutHistory',
    'WorkoutDetail',
    'ProgramOverview',
    'Drafts',
    'FeedbackReport',
    'FeedbackHistory',
    'MealEditor',
  ];

  const params: Partial<Record<SharedRouteName, object>> = {
    Profile: { initialTab: 'bookings' },
    VenueDetail: { venueId: VENUE },
    VenueReviews: { venueId: VENUE, venueName: 'Laugar' },
    AttractionDetail: { slug: 'gullfoss' },
    BookingFlow: { venueId: VENUE, activity: { id: 'a-1', name: 'Swim', provider: null } },
    Diary: { date: '2026-10-17' },
    WorkoutHistory: { segment: 'workouts' },
    WorkoutDetail: { sessionId: 's-1' },
    ProgramOverview: { programId: 'p-1', mode: 'live' },
    MealEditor: { mode: 'stored', mealId: 'm-1' },
  };

  it('the shared routes are the plan’s list', () => {
    expect(SHARED_ROUTE_NAMES).toEqual(sharedRoutes);
  });

  it('every shared route opens in every tab, on top of that tab’s own first screen', async () => {
    signedIn('Home');
    await renderShell();
    for (const tab of MAIN_TABS) {
      await act(async () => useIntentStore.getState().requestTab(tab));
      expect(currentTab()).toBe(tab);
      for (const route of sharedRoutes) {
        await act(async () => {
          (navigateInCurrentTab as (name: string, p?: object) => boolean)(route, params[route]);
        });
        expect([tab, currentRouteName()]).toEqual([tab, route]);
        await act(async () => {
          navigationRef.goBack();
        });
        expect(currentRouteName()).toBe(TAB_ROOT_SCREEN[tab]);
      }
    }
  });

  it('every root modal opens over the tabs', async () => {
    signedIn();
    await renderShell();
    const modals: [RootModalName, object | undefined, string][] = [
      ['Plans', undefined, 'Plans'],
      ['WriteReview', { venueId: VENUE, venueName: 'Laugar' }, 'WriteReview'],
      ['ClassesDiscoveryModal', undefined, 'ClassesDiscoveryModal'],
      ['MealCapture', { origin: 'scanTab' }, 'Capture'],
      ['WorkoutRunner', { sessionId: 's-1', entry: 'today' }, 'WorkoutRunner'],
    ];
    for (const [name, routeParams, shown] of modals) {
      await act(async () => {
        (openRootModal as (n: string, p?: object) => boolean)(name, routeParams);
      });
      expect(currentRouteName()).toBe(shown);
      await act(async () => {
        navigationRef.goBack();
      });
      expect(currentTab()).toBe('Explore');
    }
  });

  it('a shared route asked for over a root modal opens in the shared sheet, and closing it lands back on the modal', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      openRootModal('WorkoutRunner', { sessionId: 's-1', entry: 'today' });
    });
    await act(async () => {
      navigateInCurrentTab('Profile', { initialTab: 'bookings' });
    });
    expect(currentRouteName()).toBe('Profile');
    const rootRoutes = () => navigationRef.getRootState().routes.map((route) => route.name);
    // Over the runner, which stays as it was; never a second copy of the tabs.
    expect(rootRoutes()).toEqual(['Main', 'WorkoutRunner', 'SharedSheet']);
    // The page goes on inside the sheet.
    await act(async () => {
      navigateInCurrentTab('Account');
    });
    expect(currentRouteName()).toBe('Account');
    expect(rootRoutes()).toEqual(['Main', 'WorkoutRunner', 'SharedSheet']);
    await act(async () => navigationRef.goBack());
    expect(currentRouteName()).toBe('Profile');
    await act(async () => navigationRef.goBack());
    expect(currentRouteName()).toBe('WorkoutRunner');
    expect(rootRoutes()).toEqual(['Main', 'WorkoutRunner']);
  });

  it('a stub shows a development placeholder', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      navigateInCurrentTab('Receipts');
    });
    expect(screen.getByTestId('stub.Receipts')).toBeOnTheScreen();
  });
});
