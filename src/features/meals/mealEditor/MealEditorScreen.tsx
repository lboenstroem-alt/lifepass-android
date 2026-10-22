/**
 * Route `MealEditor` (a shared route, pushed on the tab's own stack): a
 * saved meal by id, from a diary row, Plan's drafts list or a notification
 * (iOS `PlanRoute.meal`). A confirmed meal commits every change as it is
 * made; a draft opens as a draft to check and save.
 *
 * Every change (and the read itself, as on iOS) has the day read again
 * (iOS PlanView's `onChanged: { load(force: true) }`), so Plan, Home and the
 * diary count the meal as it now is.
 */
import { useState } from 'react';

import { useHealthStore } from '../../../health/store';
import type { SharedRouteProps } from '../../../navigation/types';

import MealEditorView, { type MealEditorMode } from './MealEditorView';

function readTodayAgain(): void {
  void useHealthStore.getState().load({ force: true });
}

export default function MealEditorScreen({ route }: SharedRouteProps<'MealEditor'>) {
  const [mode] = useState<MealEditorMode>(() => ({ kind: 'stored', mealId: route.params.mealId, capture: null }));
  return <MealEditorView mode={mode} onChanged={readTodayAgain} />;
}
