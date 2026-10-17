// @f4-stub (plan 3.0.2): route `Review`, filled by MEAL-4.
//
// The tray, reviewed as a new meal (inside the meal page).
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { MealCaptureScreenProps } from '../../../navigation/types';

export default function MealReviewScreen({ route }: MealCaptureScreenProps<'Review'>) {
  return <StubScreen route={route.name} owner="MEAL-4" />;
}
