/**
 * The workout half of Plan's outbox bridge: the Android port of what iOS
 * `WorkoutRunnerSupport.installBridge` puts into `PlanOutboxBridge`
 * (Views/Workout/FinishWorkoutSheet.swift).
 *
 * PLAN-1 owns the bridge (`src/features/plan/shell/bridges.ts`,
 * `installPlanOutbox(kind, source)`); this object has exactly the shape of its
 * `PlanOutboxSource`, so installing it is one line once both packages are on
 * the same branch:
 *
 *   installPlanOutbox('workout', workoutPlanOutboxSource);
 *
 * What Plan gets from it, in iOS's order:
 *
 * - `flush` is Plan's load step "before the read" (iOS PlanView: the
 *   runner support's activate, then `PlanOutboxBridge.flush()`): the Resume
 *   row is read again from runner.json, the member's queue is loaded, and
 *   what waits is sent with FOREGROUND semantics (a member is looking at
 *   Plan, so a withdrawn consent may show its sheet). Plan reads the day
 *   itself afterwards, so no Today read follows here.
 * - `failedItems` are the items Plan's banner offers a decision on.
 * - `saveAsExtra` and `discard` act only on an item this outbox holds; a
 *   meal item belongs to the meal outbox's half.
 * - `subscribe` tells Plan when the queue changed (an item failed, or went
 *   through on an activation flush while Plan was open).
 */
import { useAppStore } from '../../../stores/appStore';

import { activateWorkoutRunnerSupport } from './support';
import {
  discardWorkoutItem,
  failedWorkoutItems,
  flushWorkoutOutbox,
  saveFailedWorkoutAsExtra,
  useWorkoutOutbox,
  type FailedOutboxItem,
} from './workoutOutbox';

/** An item as Plan's bridge names it (PLAN-1 `PlanOutboxItem`). */
export interface WorkoutPlanOutboxItem {
  readonly id: string;
  readonly kind: 'workout' | 'meal';
}

/** PLAN-1's `PlanOutboxSource`, as the workout outbox fills it. */
export interface WorkoutPlanOutboxSource {
  flush(): Promise<void>;
  failedItems(): readonly FailedOutboxItem[];
  saveAsExtra(item: WorkoutPlanOutboxItem): Promise<void>;
  discard(item: WorkoutPlanOutboxItem): Promise<void>;
  subscribe(listener: () => void): () => void;
}

function holds(item: WorkoutPlanOutboxItem): boolean {
  return item.kind === 'workout' && useWorkoutOutbox.getState().items.some((queued) => queued.id === item.id);
}

export const workoutPlanOutboxSource: WorkoutPlanOutboxSource = {
  async flush() {
    const app = useAppStore.getState();
    // iOS guards on the profile: without one there is no folder to read.
    const memberId = app.profile?.id;
    if (!memberId) return;
    await activateWorkoutRunnerSupport(memberId);
    await flushWorkoutOutbox({ foreground: true });
  },
  failedItems() {
    return failedWorkoutItems();
  },
  async saveAsExtra(item) {
    if (holds(item)) await saveFailedWorkoutAsExtra(item.id);
  },
  async discard(item) {
    if (holds(item)) discardWorkoutItem(item.id);
  },
  subscribe(listener) {
    return useWorkoutOutbox.subscribe((state, previous) => {
      if (state.items !== previous.items) listener();
    });
  },
};
