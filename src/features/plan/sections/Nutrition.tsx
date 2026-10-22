/**
 * Plan's food card slot (PLAN-5; iOS PlanView `nutritionCard(_:readOnly:)`):
 * the card (../nutrition/PlanNutritionCard.tsx) for the day on screen, with
 * Plan's doors behind its buttons.
 *
 * WHAT IT IS GIVEN, as iOS gives it:
 *   - the meals of the day on screen, and today's drafts (every estimate
 *     waiting, whatever its own date) for the drafts row;
 *   - "today" also for a future day the strip moved to: food is never
 *     logged ahead, so the card speaks of today and the meal page opens on
 *     today (`openPlanMealCapture` clamps the date);
 *   - the target weight only while the strip shows today, and only from a
 *     server that has target weights;
 *   - read only for every member who is not entitled (Plan's own rule).
 *
 * The body sheet and the target sheet are BODY-2's (../../body/sheets); the
 * meal page, the editor and the diary are the meal package's routes. Each
 * sheet's save reads the day again, as iOS's `onSaved` does; the target
 * reads the profile first (its range shapes the profile's targets too).
 */
import { useMemo } from 'react';

import { allPendingDrafts, selectHasLiveProgram, useHealthStore } from '../../../health';
import { todayServerDay } from '../../../i18n/format';
import { selectSupportsTargetWeight, useAppStore } from '../../../stores/appStore';
import { openBodySheet, openTargetSheet } from '../../body/sheets';
import PlanNutritionCard from '../nutrition/PlanNutritionCard';
import { usePlanQueuedMeals } from '../nutrition/queuedMeals';
import { openPlanMealCapture, pushPlanRoute, reloadPlan, selectPlanDate, usePlanView } from '../shell';

function reloadDay(): void {
  void reloadPlan({ force: true });
}

export default function NutritionSection() {
  const view = usePlanView();
  const today = view.today;
  const day = view.shownDay;
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const supportsTargetWeight = useAppStore(selectSupportsTargetWeight);
  const drafts = useMemo(() => (today ? allPendingDrafts(today) : []), [today]);
  const queued = usePlanQueuedMeals(day?.date ?? null);
  if (!day) return null;

  const date = day.date;
  return (
    <PlanNutritionCard
      meals={day.meals}
      drafts={drafts}
      queued={queued}
      shownDate={date}
      isToday={view.isShowingToday || day.day?.relative === 'future'}
      hasLiveProgram={hasLiveProgram}
      hasCalorieGoal={day.meals?.target?.basis === 'goal'}
      isOffline={view.isOffline}
      isReadOnly={view.isReadOnly}
      targetWeight={supportsTargetWeight && view.isShowingToday ? (today?.targetWeight ?? null) : null}
      onBackToToday={() => selectPlanDate(todayServerDay())}
      onSetTargets={() => openBodySheet({ kind: 'update', programId: day.program?.id ?? null, onSaved: reloadDay })}
      onSetGoal={() => openBodySheet({ kind: 'goal', onSaved: reloadDay })}
      onOpenMeal={(mealId) => pushPlanRoute('MealEditor', { mode: 'stored', mealId })}
      onOpenDrafts={() => pushPlanRoute('Drafts')}
      onScan={() => openPlanMealCapture('photo', date)}
      onAdd={() => openPlanMealCapture('search', date)}
      onDiary={() => pushPlanRoute('Diary', { date })}
      onSetTarget={() =>
        openTargetSheet({
          kind: 'save',
          existing: useHealthStore.getState().today?.targetWeight ?? null,
          onSaved: () => {
            void useAppStore
              .getState()
              .loadProfile()
              .then(() => reloadPlan({ force: true }));
          },
        })
      }
    />
  );
}
