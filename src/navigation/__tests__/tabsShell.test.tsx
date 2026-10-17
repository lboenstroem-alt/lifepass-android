/**
 * The signed-in shell (iOS MainTabView) with the app's real navigators: the
 * launch tab, parked tabs, notification taps, check-in links, Profile behind
 * the person buttons, the first build's route names, and every route of plan
 * 3.0.2 in place.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { handleNotificationResponse, useNotificationRouter } from '../../app/notificationRouter';
import { setAnalyticsObserver, type AnalyticsParams } from '../../lib/analytics';
import { useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { navigateInCurrentTab, openRootModal } from '../navigationRef';
import { SELECTED_TAB_KEY, useNavPrefs } from '../navPrefs';
import { SHARED_ROUTE_NAMES } from '../sharedRoutes';
import { MAIN_TABS, TAB_ROOT_SCREEN, type RootModalName, type SharedRouteName } from '../types';
import { currentRouteName, currentTab, navigationRef, renderShell, signedIn } from './shellHarness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('../../screens/home/HomeScreen', () => {
  const { Pressable: MockPressable, Text: MockText } = require('react-native');
  const { useNavigation: mockUseNavigation } = require('@react-navigation/native');
  const { openProfile: mockOpenProfile } = require('../profile');
  function Home() {
    const navigation = mockUseNavigation();
    return (
      <MockPressable accessibilityRole="button" onPress={() => mockOpenProfile(navigation, 'home_avatar')}>
        <MockText>Home avatar</MockText>
      </MockPressable>
    );
  }
  return { __esModule: true, default: Home };
});
jest.mock('../../screens/explore/ExploreScreen', () => require('./standIn').standInScreen('Explore'));
jest.mock('../../screens/coach/CoachScreen', () => require('./standIn').standInScreen('Coach'));
jest.mock('../../screens/checkin/CheckInScreen', () => require('./standIn').standInScreen('CheckIn'));
jest.mock('../../screens/bookings/BookingsScreen', () => require('./standIn').standInScreen('Library'));
jest.mock('../../screens/account/AccountScreen', () => require('./standIn').standInScreen('LegacyAccount'));
jest.mock('../../screens/account/TopUpScreen', () => require('./standIn').standInScreen('TopUp'));
jest.mock('../../screens/venue/VenueDetailScreen', () => require('./standIn').standInScreen('LegacyVenue'));
jest.mock('../../screens/booking/BookingFlowScreen', () => require('./standIn').standInScreen('LegacyBooking'));
jest.mock('../../screens/auth/OnboardingScreen', () => require('./standIn').standInScreen('Onboarding'));
jest.mock('../../screens/auth/LoginScreen', () => require('./standIn').standInScreen('Login'));
jest.mock('../../screens/auth/SignUpScreen', () => require('./standIn').standInScreen('SignUp'));
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

describe('the launch tab (ExploreLaunchTests)', () => {
  it('a cold launch opens on Explore', async () => {
    signedIn('Explore');
    await renderShell();
    expect(currentTab()).toBe('Explore');
    expect(screen.getByRole('tab', { name: 'Explore' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
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
  it('on a cold launch opens Plan with its action, not Explore', async () => {
    signedIn('Explore');
    tapNotification('plan.checkin');
    await renderShell();
    expect(currentTab()).toBe('Plan');
    expect(useIntentStore.getState().takePlanAction()?.action).toEqual({ kind: 'openWeeklyCheckIn' });
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

  it('outranks everything at a cold launch, a notification included', async () => {
    signedIn();
    tapNotification('plan');
    useIntentStore.getState().parkScanVenue(VENUE);
    await renderShell();
    expect(currentTab()).toBe('Scan');
    // Parked, for the Scan screen to ask about: never consumed by the shell.
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
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

describe('Profile behind the person buttons', () => {
  it('the Home avatar opens Profile on Bookings in the Home tab, and says where from', async () => {
    signedIn('Home');
    await renderShell();
    await fireEvent.press(screen.getByRole('button', { name: 'Home avatar' }));
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

  it('a stub shows a development placeholder', async () => {
    signedIn();
    await renderShell();
    await act(async () => {
      navigateInCurrentTab('Receipts');
    });
    expect(screen.getByTestId('stub.Receipts')).toBeOnTheScreen();
  });
});
