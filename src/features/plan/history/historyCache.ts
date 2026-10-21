/**
 * The workouts the history list read, for the detail screen it opens (iOS
 * PlanView's `historyItems`, which the `.workoutDetail(id)` route looks up).
 * There is no endpoint for one history item, so the detail draws the item
 * the list already holds, by its id (`WorkoutDetail`'s `sessionId` param:
 * "<sessionId>" or "<sessionId>:extra:<index>").
 *
 * THE LIST OWNS IT. Items are held only while a history list is mounted
 * (`retainHistoryItems`); when the last one goes (popped, Plan's stack reset
 * by a health wipe, the whole tree taken down at sign-out) the workouts go
 * with it, so no member's sets outlive the screen that read them. Memory
 * only, never written anywhere.
 */
import type { SessionHistoryItem } from '../../../health';

const items = new Map<string, SessionHistoryItem>();
let holders = 0;

/** A history list mounted; the answer releases it. */
export function retainHistoryItems(): () => void {
  holders += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) items.clear();
  };
}

/** The list read a page: its items can be opened. */
export function rememberHistoryItems(list: readonly SessionHistoryItem[]): void {
  if (holders === 0) return;
  for (const item of list) items.set(item.id, item);
}

/** The item a detail screen was opened for, or null when the list that held it has gone. */
export function historyItem(id: string): SessionHistoryItem | null {
  return items.get(id) ?? null;
}

/** Tests: nothing held. */
export function resetHistoryItemsForTests(): void {
  items.clear();
  holders = 0;
}
