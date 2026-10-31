/**
 * The shared routes (plan 3.0.2), registered in EVERY tab stack so a pushed
 * page keeps the tab bar, as an iOS NavigationStack inside the TabView does:
 * Profile from Home stays on Home, a venue opened from the Coach stays on the
 * Coach tab.
 *
 * Each route's screen lives at its owner's path (a stub until the owner
 * lands, ./stubs.tsx); this table only says which file draws which route.
 */
import type { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';

import AccountScreen from '../features/account/AccountScreen';
import ReceiptsScreen from '../features/account/receipts/ReceiptsScreen';
import PlanUsageScreen from '../features/account/usage/PlanUsageScreen';
import AttractionDetailScreen from '../features/attractions/AttractionDetailScreen';
import BodyAndGoalsScreen from '../features/body/BodyAndGoalsScreen';
import MeasurementsScreen from '../features/body/MeasurementsScreen';
import BookingFlowScreen from '../features/booking/BookingFlowScreen';
import ScanPushedScreen from '../features/checkin/scan/ScanPushedScreen';
import FeedbackHistoryScreen from '../features/feedback/FeedbackHistoryScreen';
import FeedbackReportScreen from '../features/feedback/FeedbackReportScreen';
import ProfileScreen from '../features/library/ProfileScreen';
import DiaryScreen from '../features/meals/diary/DiaryScreen';
import MealHistoryScreen from '../features/meals/history/MealHistoryScreen';
import MealEditorScreen from '../features/meals/mealEditor/MealEditorScreen';
import DraftsScreen from '../features/plan/drafts/DraftsScreen';
import WorkoutDetailScreen from '../features/plan/history/WorkoutDetailScreen';
import WorkoutHistoryScreen from '../features/plan/history/WorkoutHistoryScreen';
import ProgramOverviewScreen from '../features/plan/programOverview/ProgramOverviewScreen';
import VenueDetailScreen from '../features/venue/VenueDetailScreen';
import VenueReviewsScreen from '../features/venue/reviews/VenueReviewsScreen';
import HealthConnectDetailScreen from './screens/HealthConnectDetailScreen';
import type { SharedRouteName, SharedRouteProps, TabStackRoutes } from './types';

type SharedScreen<Name extends SharedRouteName> = ComponentType<SharedRouteProps<Name>>;

/** Which screen draws each shared route, in the plan's order. */
export const SHARED_ROUTE_SCREENS: { readonly [Name in SharedRouteName]: SharedScreen<Name> } = {
  Profile: ProfileScreen,
  Account: AccountScreen,
  Receipts: ReceiptsScreen,
  PlanUsage: PlanUsageScreen,
  VenueDetail: VenueDetailScreen,
  VenueReviews: VenueReviewsScreen,
  AttractionDetail: AttractionDetailScreen,
  BookingFlow: BookingFlowScreen,
  ScanPushed: ScanPushedScreen,
  BodyAndGoals: BodyAndGoalsScreen,
  Measurements: MeasurementsScreen,
  HealthConnectDetail: HealthConnectDetailScreen,
  Diary: DiaryScreen,
  MealHistory: MealHistoryScreen,
  WorkoutHistory: WorkoutHistoryScreen,
  WorkoutDetail: WorkoutDetailScreen,
  ProgramOverview: ProgramOverviewScreen,
  Drafts: DraftsScreen,
  FeedbackReport: FeedbackReportScreen,
  FeedbackHistory: FeedbackHistoryScreen,
  MealEditor: MealEditorScreen,
};

/** Every shared route's name, in the plan's order. */
export const SHARED_ROUTE_NAMES = Object.keys(SHARED_ROUTE_SCREENS) as SharedRouteName[];

type TabStack = ReturnType<typeof createNativeStackNavigator<TabStackRoutes>>;

/**
 * The shared routes as screens of `Stack` (one tab's stack), to put inside
 * its `Stack.Navigator` after the tab's own first screen.
 */
export function registerSharedRoutes(Stack: TabStack) {
  return (
    <Stack.Group>
      {SHARED_ROUTE_NAMES.map((name) => (
        <Stack.Screen
          key={name}
          name={name}
          // Each screen is typed for its own route; the table above checks
          // that pairing, which a mapped JSX list cannot express.
          component={SHARED_ROUTE_SCREENS[name] as ComponentType<object>}
        />
      ))}
    </Stack.Group>
  );
}
