/**
 * The five tab stacks: each tab's own first screen, then every shared route
 * (./sharedRoutes.tsx). One stack per tab, so each tab keeps its own history
 * while the member moves between tabs (iOS gives each tab its own
 * NavigationStack; Plan's is the one a notification can pop to its root).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';

import ScanScreen from '../features/checkin/scan/ScanScreen';
import PlanScreen from '../features/plan/PlanScreen';
import CoachScreen from '../screens/coach/CoachScreen';
import ExploreScreen from '../screens/explore/ExploreScreen';
import HomeScreen from '../screens/home/HomeScreen';
import { registerSharedRoutes } from './sharedRoutes';
import { TAB_ROOT_SCREEN, type MainTab, type TabStackRoutes } from './types';

/** Each tab's first screen (owners: HOME-1, EXPL-1, CHECKIN-1, COACH-1, PLAN-1). */
export const TAB_ROOT_COMPONENTS: Readonly<Record<MainTab, ComponentType<object>>> = {
  Home: HomeScreen,
  Explore: ExploreScreen,
  Scan: ScanScreen as ComponentType<object>,
  Coach: CoachScreen,
  Plan: PlanScreen as ComponentType<object>,
};

function makeTabStack(tab: MainTab): ComponentType {
  const Stack = createNativeStackNavigator<TabStackRoutes>();
  const rootName = TAB_ROOT_SCREEN[tab];
  const Root = TAB_ROOT_COMPONENTS[tab];
  function TabStack() {
    return (
      <Stack.Navigator initialRouteName={rootName} screenOptions={{ headerShown: false }}>
        <Stack.Screen name={rootName} component={Root} />
        {registerSharedRoutes(Stack)}
      </Stack.Navigator>
    );
  }
  TabStack.displayName = `${tab}Stack`;
  return TabStack;
}

export const HomeStack = makeTabStack('Home');
export const ExploreStack = makeTabStack('Explore');
export const ScanStack = makeTabStack('Scan');
export const CoachStack = makeTabStack('Coach');
export const PlanStack = makeTabStack('Plan');

export const TAB_STACKS: Readonly<Record<MainTab, ComponentType>> = {
  Home: HomeStack,
  Explore: ExploreStack,
  Scan: ScanStack,
  Coach: CoachStack,
  Plan: PlanStack,
};
