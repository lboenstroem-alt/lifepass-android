/**
 * The workout half of Plan's outbox bridge: the Android port of what iOS
 * `WorkoutRunnerSupport.installBridge` puts into `PlanOutboxBridge`
 * (Views/Workout/FinishWorkoutSheet.swift).
 *
 * PLAN-1 owns the bridge (`src/features/plan/shell/bridges.ts`,
 * `installPlanOutbox(kind, source)`); this object fills its
 * `PlanOutboxSource`, so installing it is one line in ../register.ts once
 * both packages are on the same branch (the merge checklist there; a test,
 * ./__tests__/planBridgeInstall.test.ts, fails until it is in):
 *
 *   installPlanOutbox('workout', workoutPlanOutboxSource);
 *
 * NOT INSTALLED ON THIS BRANCH. Until it is, Plan's load sends nothing with
 * foreground semantics and shows no failed-item banner; the activation hooks
 * (../register.ts) still send the queue on every profile load and return to
 * the foreground, and a failed item waits on disk for the banner.
 *
 * What Plan gets from it, in iOS's order:
 *
 * - `activate` is Plan's APPEARANCE (iOS PlanView's `.task`:
 *   `WorkoutRunnerSupport.activate` runs before `load()` and before its
 *   minor and consent guard): the Resume row is read again from runner.json
 *   (one past its day is deleted) and the member's queue is loaded. It is
 *   not a PLAN-1 `PlanOutboxSource` member yet: contract request to PLAN-1 to
 *   call `source.activate?.()` on every appearance ahead of `reloadPlan`'s
 *   guard. Until then `flush` runs it, behind that guard.
 * - `flush` is Plan's load step "before the read" (iOS `PlanOutboxBridge
 *   .flush()`): what waits is sent with FOREGROUND semantics (a member is
 *   looking at Plan, so a withdrawn consent may show its sheet). Plan reads
 *   the day itself afterwards, so no Today read follows here.
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

/** PLAN-1's `PlanOutboxSource`, as the workout outbox fills it, plus `activate`. */
export interface WorkoutPlanOutboxSource {
  activate(): Promise<void>;
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
  async activate() {
    // iOS guards on the profile: without one there is no folder to read.
    const memberId = useAppStore.getState().profile?.id;
    if (memberId) await activateWorkoutRunnerSupport(memberId);
  },
  async flush() {
    if (!useAppStore.getState().profile?.id) return;
    // Cheap when `activate` already ran on this appearance: the queue is
    // loaded once per member, runner.json is one small read.
    await workoutPlanOutboxSource.activate();
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
