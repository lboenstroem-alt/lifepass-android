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
 * The tabs OPEN on the tab those intents are about to switch to
 * (`openingTab`), not on the launch tab and then away: tab screens stay
 * mounted, and an Explore that mounted first would take the launch-time
 * filter presentation and keep its filters open for the member's next visit
 * (iOS rebuilds Explore on the switch; a tapped notification also cancels
 * the presentation as it is parked, src/app/notificationRouter.ts).
 *
 * A switch while a root modal or the shared sheet is on top leaves it first
 * through a removal the back guards see (`popTo('Main')`, src/navigation/guards.ts):
 * a modal that is busy (a checkout or a booking in flight) refuses it, and
 * the switch waits until the modal is gone. iOS rebuilds the tab's content on
 * a switch, which takes its sheets with it; Android does the same once the
 * work has finished on screen. A switch that keeps the tab (Plan asked for on
 * Plan) leaves the modal as it is, as iOS keeps Plan's runner cover.
 *
 * It remembers the tab on screen (the launch rule reads it), retires the Plan
 * tab's dot at the first visit, and draws the app-wide sheets over every tab:
 * the Kenni nudge, the meal chrome (toasts and the membership gate) and the
 * sheets packages open imperatively (among them the deletion sheet a
 * refusal's "Cancel deletion" opens over the refusing screen, as iOS
 * `RefusalStepPresenter` does). Those hosts sit outside any screen
 * (their `useNavigation()` is the root's `Main` route), so a page they open
 * goes through `openSharedRoute` (./sharedSheet.ts).
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
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { consumeNotificationRoute, destinationFor, useNotificationRouter } from '../app/notificationRouter';
import { AccountDeletionHost } from '../features/account/deletion/ui';
import { BodySheetsHost } from '../features/body/sheets';
import { ClassSheetHost } from '../features/classes/sheet';
import { KenniNudgeHost } from '../features/kenni';
import MealGlobalChromeHost from '../features/meals/MealGlobalChromeHost';
import { DescribeHost } from '../features/meals/describe';
import { ChangeDaysHost } from '../features/plan/days';
import { useAppStore } from '../stores/appStore';
import { useIntentStore } from '../stores/intentStore';
import CustomTabBar from './CustomTabBar';
import { navigationRef, rootRouteName } from './navigationRef';
import { initialTabForShell, markPlanTabSeen, noteSelectedTab } from './navPrefs';
import { TAB_STACKS } from './tabStacks';
import { MAIN_TABS, type MainTab, type MainTabRoutes } from './types';

const Tab = createBottomTabNavigator<MainTabRoutes>();

type TabsState = TabNavigationState<ParamListBase>;

interface TabsNavigation {
  navigate(name: string): void;
  dispatch(action: { readonly type: string; readonly target?: string }): void;
  /** The navigator's state now (updated as each action is handled, before any re-render). */
  getState(): unknown;
}

function tabOf(state: TabsState): MainTab {
  return state.routes[state.index]?.name as MainTab;
}

/**
 * The tab the shell opens on: the one its parked intents are about to switch
 * to, in the first-appearance effect's order (the last switch there wins): a
 * check-in link, else a tapped notification (signed in), else a parked tab,
 * else the tab last on screen or the launch tab.
 */
export function openingTab(): MainTab {
  const intents = useIntentStore.getState();
  if (intents.pendingScanVenueId !== null) return 'Scan';
  const tapped = useNotificationRouter.getState().pending;
  if (tapped && useAppStore.getState().isAuthenticated) return destinationFor(tapped).tab;
  return intents.pendingTab ?? initialTabForShell();
}

/**
 * iOS `consumePendingTab`: perform a parked tab change. Reads the tabs' state
 * now, not a render's (a held switch runs from a state listener).
 */
function selectTab(target: MainTab, navigation: TabsNavigation): void {
  const state = navigation.getState() as TabsState;
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
  // Effects use the latest navigation, not the one they closed over.
  const latest = useRef({ navigation });
  latest.current = { navigation };

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
  // A switch held back by a busy modal, performed once the modal is gone.
  const heldTab = useRef<MainTab | null>(null);

  /**
   * Every switch the shell performs. A switch to another tab while a root
   * modal or the shared sheet is on top asks the root stack to pop back to
   * the tabs first: a busy modal's guard refuses that (a plain focus change
   * would remove it without asking), and the switch is held until it is gone.
   */
  function switchTo(target: MainTab): void {
    const tabsNavigation = latest.current.navigation;
    const root = rootRouteName();
    if (target !== tabOf(tabsNavigation.getState() as TabsState) && root !== null && root !== 'Main') {
      heldTab.current = target;
      navigationRef.dispatch(StackActions.popTo('Main'));
      return;
    }
    heldTab.current = null;
    selectTab(target, tabsNavigation);
  }
  const switchRef = useRef(switchTo);
  switchRef.current = switchTo;

  // A held switch: performed when the tabs are on top again (the modal
  // finished and closed, or the pop above went through).
  useEffect(
    () =>
      navigationRef.addListener('state', () => {
        const held = heldTab.current;
        if (held === null || rootRouteName() !== 'Main') return;
        heldTab.current = null;
        switchRef.current(held);
      }),
    [],
  );

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
    switchRef.current(pendingTab);
  }, [pendingTab]);

  // 3. A check-in link: Scan, over everything (the intent store has already
  // retracted the Kenni nudge, without counting it as dismissed).
  useEffect(() => {
    if (!appeared.current || scanLinkCount === 0) return;
    switchRef.current('Scan');
  }, [scanLinkCount]);

  // At first appearance, in iOS onAppear's order: a cold launch from a
  // notification or a link delivered it before this shell existed. The last
  // switch iOS makes there is the one that shows, so only that one is made
  // (the navigator's state is not settled until after this first commit, so
  // two switches in a row here would read the opening tab for both).
  useEffect(() => {
    appeared.current = true;
    consumeNotificationRoute(useAppStore.getState().isAuthenticated);
    const intents = useIntentStore.getState();
    const tab = intents.pendingTab;
    if (tab) intents.clearPendingTab();
    const target = useIntentStore.getState().pendingScanVenueId !== null ? 'Scan' : tab;
    if (target) switchRef.current(target);
  }, []);

  return (
    <>
      {children}
      <KenniNudgeHost />
      <AccountDeletionHost />
      <BodySheetsHost />
      <ChangeDaysHost />
      <ClassSheetHost />
      <DescribeHost />
      <MealGlobalChromeHost />
    </>
  );
}

export default function TabNavigator() {
  // Read once per mount: where a parked intent is going, else the launch tab
  // at a cold start, else the tab last on screen (after a sign-out and sign-in).
  const [initialTab] = useState(openingTab);
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
