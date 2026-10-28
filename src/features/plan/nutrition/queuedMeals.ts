/**
 * Meals saved with no connection, waiting in the meal outbox, as Plan's food
 * card draws them (iOS `MealOutbox.shared.pending(on:)` in
 * PlanNutritionCard): a meal logged offline is visibly kept, with "Waiting
 * to sync", until the flush sends it and the next read brings it back as a
 * saved meal.
 *
 * The outbox is the meal package's (MEAL-1, `src/features/meals/outbox`),
 * which lands after Plan's card; it plugs in here, once, the way it plugs
 * its failed items into Plan's banner (../shell/bridges.ts):
 *
 *   installPlanQueuedMeals({
 *     pendingOn: (date) => pendingMealsOn(date).map((item) => ({
 *       id: item.id, slot: item.body.slot, labels: item.body.items.map((i) => i.label),
 *     })),
 *     subscribe: (listener) => useMealOutbox.subscribe(() => listener()),
 *   });
 *
 * Until it does, nothing is queued, which is the truth on a build without
 * the outbox.
 *
 * MERGE GATE: ./__tests__/queuedMealsMergeGate.test.tsx is skipped while
 * the outbox is not on the branch; once it is, the test runs against the
 * real outbox and fails until the meal package's register.ts makes the
 * install above.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

/** One queued meal, as the card's row needs it. */
export interface PlanQueuedMeal {
  readonly id: string;
  /** The slot as it will be sent (`breakfast`, `lunch`, ...). */
  readonly slot: string;
  /** Each item's label, in order. */
  readonly labels: readonly string[];
}

export interface PlanQueuedMealsSource {
  /** The queued meals for a server day, oldest first. */
  pendingOn(date: string): readonly PlanQueuedMeal[];
  /** Called when the queue changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

interface QueuedMealsState {
  readonly source: PlanQueuedMealsSource | null;
  /** Bumped on every change of the queue, so the card reads it again. */
  readonly version: number;
}

const useQueuedMealsStore = create<QueuedMealsState>()(() => ({ source: null, version: 0 }));

/** The meal package installs its outbox; the answer uninstalls it. */
export function installPlanQueuedMeals(source: PlanQueuedMealsSource): () => void {
  const bump = () => useQueuedMealsStore.setState((state) => ({ version: state.version + 1 }));
  const unsubscribe = source.subscribe(bump);
  useQueuedMealsStore.setState((state) => ({ source, version: state.version + 1 }));
  return () => {
    unsubscribe();
    if (useQueuedMealsStore.getState().source !== source) return;
    useQueuedMealsStore.setState((state) => ({ source: null, version: state.version + 1 }));
  };
}

/** The queued meals for `date`; redrawn when the queue changes. A source that throws counts as empty. */
export function usePlanQueuedMeals(date: string | null): readonly PlanQueuedMeal[] {
  const source = useQueuedMealsStore((s) => s.source);
  const version = useQueuedMealsStore((s) => s.version);
  return useMemo(() => {
    if (!source || date === null) return [];
    try {
      // `version` is what changes when the queue does.
      return version >= 0 ? [...source.pendingOn(date)] : [];
    } catch {
      return [];
    }
  }, [source, version, date]);
}

/** Tests: no outbox installed. */
export function resetPlanQueuedMealsForTests(): void {
  useQueuedMealsStore.setState({ source: null, version: 0 });
}
