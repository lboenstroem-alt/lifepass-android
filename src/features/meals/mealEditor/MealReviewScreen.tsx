/**
 * Route `Review` inside the meal page (iOS `MealCaptureRoute.review`): the
 * page's tray, reviewed as a new meal before its first save. The tray, its
 * slot and date, and the save belong to the page (MEAL-2's capture model);
 * this screen is the editor over them.
 */
import { useEffect } from 'react';

import type { MealCaptureScreenProps } from '../../../navigation/types';

import { useMealCaptureLink } from './captureLink';
import MealEditorView from './MealEditorView';

export default function MealReviewScreen({ navigation }: MealCaptureScreenProps<'Review'>) {
  const capture = useMealCaptureLink();
  // Pushed only from the page's tray bar, so the page is there; should it
  // not be, there is nothing to review and the member goes back to it.
  useEffect(() => {
    if (!capture && navigation.canGoBack()) navigation.goBack();
  }, [capture, navigation]);
  if (!capture) return null;
  return <MealEditorView mode={{ kind: 'tray', capture }} testID="mealReview" />;
}
