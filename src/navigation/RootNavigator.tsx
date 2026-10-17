/**
 * The root of the app (iOS ContentView): the launch screen until the session
 * is resolved and the first profile read has answered (and launch has chosen
 * its tab), then the signed-in tabs with the root modals over them, or the
 * sign-in screens. The navigator gates on the app store's `isAuthenticated`,
 * as iOS ContentView does, not on a session object.
 *
 * The set-new-password screen after a reset link sits over both (AUTH-1's
 * host), as iOS ContentView presents it over whatever is showing.
 *
 * Root modals cover the tab bar (iOS sheets and full-screen covers): Plans,
 * WriteReview and the classes sheet slide up over it; the meal page and the
 * workout runner take the whole screen. The shared sheet (F4's own) slides a
 * shared route up over a modal that cannot push it (./SharedSheetNavigator.tsx).
 * None of them has a tab bar under it (./NoTabBarLayout.tsx).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LaunchScreen from '../components/LaunchScreen';
import PasswordRecoveryHost from '../features/auth/PasswordRecoveryHost';
import ClassesDiscoveryModalScreen from '../features/classes/ClassesDiscoveryModalScreen';
import PlansScreen from '../features/plans/PlansScreen';
import WorkoutRunnerScreen from '../features/runner/screen/WorkoutRunnerScreen';
import WriteReviewScreen from '../features/venue/reviews/WriteReviewScreen';
import { useAppStore } from '../stores/appStore';
import AuthNavigator from './AuthNavigator';
import MealCaptureNavigator from './MealCaptureNavigator';
import { useNavPrefs } from './navPrefs';
import { noTabBarScreenLayout } from './NoTabBarLayout';
import SharedSheetNavigator from './SharedSheetNavigator';
import TabNavigator from './TabNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const isLoading = useAppStore((s) => s.isLoading);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const launchDecided = useNavPrefs((s) => s.launchTab !== null);

  if (isLoading || !launchDecided) return <LaunchScreen />;

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Group screenOptions={{ presentation: 'modal' }} screenLayout={noTabBarScreenLayout}>
              <Stack.Screen name="Plans" component={PlansScreen} />
              <Stack.Screen name="WriteReview" component={WriteReviewScreen} />
              <Stack.Screen name="ClassesDiscoveryModal" component={ClassesDiscoveryModalScreen} />
              <Stack.Screen name="SharedSheet" component={SharedSheetNavigator} />
            </Stack.Group>
            <Stack.Group screenOptions={{ presentation: 'fullScreenModal' }} screenLayout={noTabBarScreenLayout}>
              <Stack.Screen name="MealCapture" component={MealCaptureNavigator} />
              <Stack.Screen name="WorkoutRunner" component={WorkoutRunnerScreen} />
            </Stack.Group>
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
      {/* Set a new password after a reset link, over whatever shows (iOS ContentView's sheet). */}
      <PasswordRecoveryHost />
    </>
  );
}
