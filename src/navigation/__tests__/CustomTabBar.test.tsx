/**
 * What TalkBack hears on the bar: ports of iOS NavigationAccessibilityUITests
 * (the bar announces Plan with "New" while its dot shows; Icelandic labels;
 * the centre button says Scan, never its icon, and is selected on the Scan
 * tab), plus the Plan dot's rules, the dark treatment and the analytics.
 * Rendered in a real tab navigator with stand-in screens.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, Text } from 'react-native';

import { setAnalyticsObserver, type AnalyticsParams } from '../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../stores/intentStore';
import type { HealthAccess } from '../../api/profile';
import CustomTabBar from '../CustomTabBar';
import { markPlanTabSeen, resetNavPrefsForTests, useNavPrefs } from '../navPrefs';
import { MAIN_TABS, type MainTab } from '../types';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const Tab = createBottomTabNavigator();

function Bar({ initialTab = 'Home' }: { initialTab?: MainTab }) {
  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName={initialTab}
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {MAIN_TABS.map((tab) => (
          <Tab.Screen key={tab} name={tab}>
            {() => <Text>{`${tab} screen`}</Text>}
          </Tab.Screen>
        ))}
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function member(access: HealthAccess, language: 'en' | 'is' = 'en') {
  useAppStore.setState({ isAuthenticated: true, healthAccessOverride: access, cachedAccountLanguage: language });
}

const selected: AnalyticsParams[] = [];

beforeEach(() => {
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetNavPrefsForTests();
  useNavPrefs.setState({ hydrated: true });
  selected.length = 0;
  setAnalyticsObserver((event, params) => {
    if (event === 'nav_tab_selected') selected.push(params);
  });
});

afterEach(() => {
  setAnalyticsObserver(null);
  resetAppStoreForTests();
  jest.restoreAllMocks();
});

describe('NavigationAccessibilityUITests', () => {
  // testTheBarAnnouncesPlanAndItsNewDot
  it('the fifth tab announces itself as Plan, and its dot is spoken as New', async () => {
    member('entitled');
    await render(<Bar />);
    const plan = screen.getByRole('tab', { name: 'Plan' });
    expect(plan).toHaveAccessibilityValue({ text: 'New' });
    // Nothing was removed: Home, Explore and Coach are still there.
    for (const label of ['Home', 'Explore', 'Coach']) {
      expect(screen.getByRole('tab', { name: label })).toBeOnTheScreen();
    }
    expect(screen.queryByRole('tab', { name: 'Profile' })).toBeNull();
  });

  // testTheBarIsInIcelandicForAnIcelandicAccount
  it('is in Icelandic for an Icelandic account', async () => {
    member('entitled', 'is');
    await render(<Bar />);
    for (const label of ['Heim', 'Skoða', 'Skanna', 'Ráðgjafi', 'Áætlun']) {
      expect(screen.getByRole('tab', { name: label })).toBeOnTheScreen();
    }
    expect(screen.getByRole('tab', { name: 'Áætlun' })).toHaveAccessibilityValue({ text: 'Nýtt' });
    expect(screen.getByText('ÁÆTLUN')).toBeOnTheScreen();
  });

  // testTheScanButtonSaysScanAndNotItsSymbolName
  it('the centre button says Scan, in both languages', async () => {
    for (const [language, label] of [
      ['en', 'Scan'],
      ['is', 'Skanna'],
    ] as const) {
      member('entitled', language);
      const view = await render(<Bar />);
      const scan = screen.getByTestId('tab.Scan');
      expect(scan).toHaveAccessibleName(label);
      expect(scan).toHaveProp('accessibilityRole', 'tab');
      await view.unmount();
    }
  });

  // testTheScanButtonIsSelectedOnTheScanTab
  it('the centre button is selected on the Scan tab, as the other four are on theirs', async () => {
    member('entitled');
    const view = await render(<Bar initialTab="Home" />);
    expect(screen.getByRole('tab', { name: 'Scan' })).not.toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).toBeSelected();
    await view.unmount();

    await render(<Bar initialTab="Scan" />);
    expect(screen.getByRole('tab', { name: 'Scan' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
  });
});

describe('the Plan dot', () => {
  it('shows to entitled members only', async () => {
    for (const access of ['not_member', 'pass_only', 'past_due', 'company_inactive', 'minor'] as const) {
      member(access);
      const view = await render(<Bar />);
      expect(screen.queryByTestId('tab.Plan.dot')).toBeNull();
      expect(screen.getByRole('tab', { name: 'Plan' })).not.toHaveAccessibilityValue({ text: 'New' });
      await view.unmount();
    }
  });

  it('goes for good once the member has opened Plan', async () => {
    member('entitled');
    await render(<Bar />);
    expect(screen.getByTestId('tab.Plan.dot')).toBeOnTheScreen();
    await act(async () => markPlanTabSeen());
    expect(screen.queryByTestId('tab.Plan.dot')).toBeNull();
  });

  it('never flashes on before the stored "seen" is read', async () => {
    member('entitled');
    useNavPrefs.setState({ hydrated: false });
    await render(<Bar />);
    expect(screen.queryByTestId('tab.Plan.dot')).toBeNull();
  });
});

describe('selecting a tab', () => {
  it('moves to it, marks it selected and records which tab', async () => {
    member('entitled');
    await render(<Bar />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Coach' }));
    expect(screen.getByRole('tab', { name: 'Coach' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Scan' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan' }));
    expect(selected).toEqual([{ tab: 'coach' }, { tab: 'scan' }, { tab: 'plan' }]);
  });
});

describe('the dark treatment', () => {
  it('over Coach, and over Scan only while the camera is live', async () => {
    member('entitled');
    await render(<Bar />);
    expect(screen.getByTestId('tab-bar.light')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'Coach' }));
    expect(screen.getByTestId('tab-bar.dark')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'Scan' }));
    expect(screen.getByTestId('tab-bar.light')).toBeOnTheScreen();
    await act(async () => useIntentStore.getState().setScanCameraLive(true));
    expect(screen.getByTestId('tab-bar.dark')).toBeOnTheScreen();
  });
});

describe('the keyboard', () => {
  it('covers the bar, as on iOS: the bar is not drawn while it is up', async () => {
    const listeners: Record<string, () => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, listener: () => void) => {
      listeners[event] = listener;
      return { remove: jest.fn() };
    }) as never);
    member('entitled');
    await render(<Bar />);
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
    await act(async () => listeners.keyboardDidShow?.());
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await act(async () => listeners.keyboardDidHide?.());
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen();
  });
});
