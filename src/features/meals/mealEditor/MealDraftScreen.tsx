/**
 * Route `Draft` inside the meal page (iOS `MealCaptureRoute.photoDraft`): an
 * estimate the server just saved as a draft, from a photo (OP-32) or a
 * description (OP-56), opened over the page so the member checks it and
 * saves it. Items already on the page's tray join it (12.4).
 *
 * The page keeps the meal it was handed (`drafts[mealId]`); when it only has
 * the id, the editor reads the draft by id, inside the page all the same.
 */
import { useState } from 'react';

import type { MealCaptureScreenProps } from '../../../navigation/types';

import { useMealCaptureLink } from './captureLink';
import MealEditorView, { type MealEditorMode } from './MealEditorView';

export default function MealDraftScreen({ route }: MealCaptureScreenProps<'Draft'>) {
  const capture = useMealCaptureLink();
  const [mode] = useState<MealEditorMode>(() => {
    const mealId = route.params.mealId;
    const meal = capture?.store.getState().drafts[mealId];
    return meal ? { kind: 'draft', meal, capture } : { kind: 'stored', mealId, capture };
  });
  return <MealEditorView mode={mode} testID="mealDraft" />;
}
