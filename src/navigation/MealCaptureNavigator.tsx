/**
 * The meal page's own stack (root modal `MealCapture`, full screen): the
 * capture page, then the tray's review or a saved draft, pushed inside the
 * cover so closing the cover closes them too (iOS `MealCaptureRoute`).
 * Owners: MEAL-2 (Capture), MEAL-4 (Review, Draft).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MealCaptureScreen from '../features/meals/capture/MealCaptureScreen';
import MealDraftScreen from '../features/meals/mealEditor/MealDraftScreen';
import MealReviewScreen from '../features/meals/mealEditor/MealReviewScreen';
import type { MealCaptureRoutes, RootModalProps } from './types';

const Stack = createNativeStackNavigator<MealCaptureRoutes>();

export default function MealCaptureNavigator({ route }: RootModalProps<'MealCapture'>) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Capture" component={MealCaptureScreen} initialParams={route.params} />
      <Stack.Screen name="Review" component={MealReviewScreen} />
      <Stack.Screen name="Draft" component={MealDraftScreen} />
    </Stack.Navigator>
  );
}
