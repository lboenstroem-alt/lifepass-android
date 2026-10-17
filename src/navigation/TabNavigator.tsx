/**
 * The signed-in app: five tabs, each its own stack, and the shell around them
 * that owns the tab selection. The Android port of iOS `MainTabView`
 * (Navigation/MainTabView.swift).
 *
 * The shell is the only place that changes the tab on another screen's
 * behalf. It takes, in this order, at its first appearance and whenever one
 * changes:
 *   1. a tapped notification (src/app/notificationRouter.ts): Plan, plus the
 *      action Plan performs after its read; dropped while signed out;
 *   2. a parked tab (`requestTab`): asking for Plan while on Plan pops Plan
 *      back to its first screen, which is how a notification tap gets a
 *      member back to Plan's root when they left it three screens deep;
 *   3. a check-in link (each arrival, `scanLinkCount`; at first appearance a
 *      venue still parked, `pendingScanVenueId`): the Scan tab. A member
 *      walking up to a door outranks everything, so this comes last and wins.
 *
 * It remembers the tab on screen (the launch rule reads it), retires the Plan
 * tab's dot at the first visit, and draws the app-wide sheets over every tab:
 * the Kenni nudge and the sheets packages open imperatively. Those hosts sit
 * outside any screen (their `useNavigation()` is the root's `Main` route), so
 * a page they open goes through `openSharedRoute` (./sharedSheet.ts).
 *
 * Back: `backBehavior: 'history'`. Back on a tab's first screen returns to
 * the tab the member came from, and back on the first tab of the session
 * (Explore after a normal launch) leaves the app.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  StackActions,
  type NavigationState,
  type ParamListBase,
  type PartialState,
  type TabNavigationState,
} from '@react-navigation/native';
import { useEffect, useRef, type ReactNode } from 'react';

import { consumeNotificationRoute, useNotificationRouter } from '../app/notificationRouter';
import { BodySheetsHost } from '../features/body/sheets';
import { ClassSheetHost } from '../features/classes/sheet';
import { KenniNudgeHost } from '../features/kenni';
import { DescribeHost } from '../features/meals/describe';
import { ChangeDaysHost } from '../features/plan/days';
import { useAppStore } from '../stores/appStore';
import { useIntentStore } from '../stores/intentStore';
import CustomTabBar from './CustomTabBar';
import { initialTabForShell, markPlanTabSeen, noteSelectedTab } from './navPrefs';
import { TAB_STACKS } from './tabStacks';
import { MAIN_TABS, type MainTab, type MainTabRoutes } from './types';

const Tab = createBottomTabNavigator<MainTabRoutes>();

type TabsState = TabNavigationState<ParamListBase>;

interface TabsNavigation {
  navigate(name: string): void;
  dispatch(action: { readonly type: string; readonly target?: string }): void;
}

function tabOf(state: TabsState): MainTab {
  return state.routes[state.index]?.name as MainTab;
}

/** iOS `consumePendingTab`: perform a parked tab change. */
function selectTab(target: MainTab, state: TabsState, navigation: TabsNavigation): void {
  if (target === 'Plan' && tabOf(state) === 'Plan') {
    // Asking for the tab you are on is not a no-op for Plan: back to its root.
    const plan = state.routes.find((route) => route.name === 'Plan');
    const stack = plan?.state as NavigationState | PartialState<NavigationState> | undefined;
    if (stack && typeof stack.index === 'number' && stack.index > 0 && stack.key) {
      navigation.dispatch({ ...StackActions.popToTop(), target: stack.key });
    }
    return;
  }
  if (tabOf(state) !== target) navigation.navigate(target);
}

function TabsLayout({
  state,
  navigation,
  children,
}: {
  state: TabsState;
  navigation: TabsNavigation;
  children: ReactNode;
}) {
  // Effects read the latest state, not the one they closed over.
  const latest = useRef({ state, navigation });
  latest.current = { state, navigation };

  const pendingTab = useIntentStore((s) => s.pendingTab);
  // Every arrival, not the id: a second link to a venue still parked is the
  // same id, and must still bring Scan forward.
  const scanLinkCount = useIntentStore((s) => s.scanLinkCount);
  const pendingRoute = useNotificationRouter((s) => s.pending);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const current = tabOf(state);
  // False until the first-appearance effect (declared LAST, so it runs after
  // the change effects below, which skip that first commit) has run.
  const appeared = useRef(false);

  // The tab on screen: remembered, and Plan's dot retired at the first visit.
  useEffect(() => {
    noteSelectedTab(current);
    if (current === 'Plan') markPlanTabSeen();
  }, [current]);

  // 1. A tapped notification, while the shell is up.
  useEffect(() => {
    if (!appeared.current || pendingRoute === null) return;
    consumeNotificationRoute(isAuthenticated);
  }, [pendingRoute, isAuthenticated]);

  // 2. A parked tab.
  useEffect(() => {
    if (!appeared.current || pendingTab === null) return;
    useIntentStore.getState().clearPendingTab();
    selectTab(pendingTab, latest.current.state, latest.current.navigation);
  }, [pendingTab]);

  // 3. A check-in link: Scan, over everything (the intent store has already
  // retracted the Kenni nudge, without counting it as dismissed).
  useEffect(() => {
    if (!appeared.current || scanLinkCount === 0) return;
    selectTab('Scan', latest.current.state, latest.current.navigation);
  }, [scanLinkCount]);

  // At first appearance, in iOS onAppear's order: a cold launch from a
  // notification or a link delivered it before this shell existed.
  useEffect(() => {
    appeared.current = true;
    consumeNotificationRoute(useAppStore.getState().isAuthenticated);
    const intents = useIntentStore.getState();
    const tab = intents.pendingTab;
    if (tab) {
      intents.clearPendingTab();
      selectTab(tab, latest.current.state, latest.current.navigation);
    }
    if (useIntentStore.getState().pendingScanVenueId !== null) {
      selectTab('Scan', latest.current.state, latest.current.navigation);
    }
  }, []);

  return (
    <>
      {children}
      <KenniNudgeHost />
      <BodySheetsHost />
      <ChangeDaysHost />
      <ClassSheetHost />
      <DescribeHost />
    </>
  );
}

export default function TabNavigator() {
  // Read once per mount: the launch tab at a cold start, else the tab last on
  // screen (after a sign-out and sign-in).
  const initialTab = useRef(initialTabForShell()).current;
  return (
    <Tab.Navigator
      initialRouteName={initialTab}
      backBehavior="history"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      layout={({ state, navigation, children }) => (
        <TabsLayout state={state as TabsState} navigation={navigation as unknown as TabsNavigation}>
          {children}
        </TabsLayout>
      )}
    >
      {MAIN_TABS.map((tab) => (
        <Tab.Screen key={tab} name={tab} component={TAB_STACKS[tab]} />
      ))}
    </Tab.Navigator>
  );
}
