/**
 * What Plan needs from packages that land after it, and nothing more: the
 * Android port of iOS `PlanOutboxBridge` and of the places PlanView calls
 * straight into the feedback store and the weekly check-in sheet.
 *
 * THE SHELL IS BUILT; THE QUEUES, THE FEEDBACK AND THE CHECK-IN ARE NOT. The
 * failed-item banner, the feedback scroll and the check-in notification's
 * routing live here, finished, behind installs that default to "nothing is
 * there", which is the truth until their packages land. Nothing is hidden
 * behind a flag: the banner appears the moment an item exists, and a
 * notification tap reaches the sheet the moment its package installs it.
 *
 * WHO INSTALLS WHAT, once, early (their own register.ts, or the module the
 * Plan screen already imports):
 *
 *   // RUN-1 (the workout outbox) and MEAL-1 (the meal outbox):
 *   installPlanOutbox('workout', {
 *     flush: () => WorkoutOutbox.flush(),
 *     failedItems: () => WorkoutOutbox.failed().map((id) => ({ id, kind: 'workout' })),
 *     saveAsExtra: (item) => WorkoutOutbox.repost(item.id, { asExtra: true }),
 *     discard: (item) => WorkoutOutbox.remove(item.id),
 *     subscribe: (listener) => WorkoutOutbox.subscribe(listener),
 *   });
 *
 *   // FEED-1 (the monthly feedback):
 *   installPlanFeedback({ isAvailable, refresh, loadState, latestCurrentReportId, hasCardContent, subscribe });
 *
 *   // PLAN-5 (the weekly check-in sheet):
 *   installWeeklyCheckInOpener((entry) => openWeeklyCheckInSheet(entry));
 *
 * Each install answers an uninstall. `outbox_item_discarded` is reported by
 * Plan (iOS 3.5); `workout_outbox_flushed` and `meal_outbox_flushed` belong
 * to whoever does the posting.
 */
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// The outboxes (iOS PlanOutboxBridge)

export type PlanOutboxKind = 'workout' | 'meal';

/** An item this phone saved that the server will not take. */
export interface PlanOutboxItem {
  readonly id: string;
  readonly kind: PlanOutboxKind;
}

export interface PlanOutboxSource {
  /** Post what is queued, each item in turn (Plan flushes the workout outbox first). */
  flush(): Promise<void>;
  /** The items that came back failed and are waiting for the member's decision. */
  failedItems(): readonly PlanOutboxItem[];
  /** Repost a failed workout with a new key and `asExtra: true` (workouts only). */
  saveAsExtra?(item: PlanOutboxItem): Promise<void>;
  /** Throw the item away. Plan asks for a confirmation first. */
  discard(item: PlanOutboxItem): Promise<void>;
  /** Called when the queue changes (an item failed, or went through in the background). */
  subscribe?(listener: () => void): () => void;
}

/** The weekly check-in sheet's `weekly_checkin_opened.entry`. */
export type WeeklyCheckInEntry = 'plan' | 'review_card' | 'notification';

/** The feedback store's read, as Plan waits on it. */
export type PlanFeedbackLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** The monthly feedback, as Plan's load sequence and its notification taps use it (FEED-1). */
export interface PlanFeedbackBridge {
  /**
   * The feature is usable beyond the server's flag (iOS `supportsFeedback`:
   * the feedback store's own stale-feature check). Plan asks the app store
   * for the flag itself.
   */
  isAvailable(): boolean;
  /** The feedback read, throttled unless forced (pull to refresh). */
  refresh(force: boolean): Promise<void>;
  loadState(): PlanFeedbackLoadState;
  /** The latest report, when it is the current month's (iOS `summary.latest` with `current`). */
  latestCurrentReportId(): string | null;
  /** The card has something to draw (iOS `!FeedbackCardState.isEmpty`). */
  hasCardContent(): boolean;
  /** Called when the read's state or the card's content changes. */
  subscribe(listener: () => void): () => void;
}

interface BridgeState {
  readonly outboxes: Readonly<Partial<Record<PlanOutboxKind, PlanOutboxSource>>>;
  readonly feedback: PlanFeedbackBridge | null;
  readonly weeklyCheckIn: ((entry: WeeklyCheckInEntry) => void) | null;
}

/** Subscribe with `usePlanBridges(selector)` to re-render when a package installs. */
export const usePlanBridges = create<BridgeState>()(() => ({ outboxes: {}, feedback: null, weeklyCheckIn: null }));

export function installPlanOutbox(kind: PlanOutboxKind, source: PlanOutboxSource): () => void {
  usePlanBridges.setState((state) => ({ outboxes: { ...state.outboxes, [kind]: source } }));
  return () => {
    if (usePlanBridges.getState().outboxes[kind] !== source) return;
    usePlanBridges.setState((state) => {
      const outboxes = { ...state.outboxes };
      delete outboxes[kind];
      return { outboxes };
    });
  };
}

export function installPlanFeedback(bridge: PlanFeedbackBridge): () => void {
  usePlanBridges.setState({ feedback: bridge });
  return () => {
    if (usePlanBridges.getState().feedback === bridge) usePlanBridges.setState({ feedback: null });
  };
}

export function installWeeklyCheckInOpener(open: (entry: WeeklyCheckInEntry) => void): () => void {
  usePlanBridges.setState({ weeklyCheckIn: open });
  return () => {
    if (usePlanBridges.getState().weeklyCheckIn === open) usePlanBridges.setState({ weeklyCheckIn: null });
  };
}

/** The outboxes in flush order: the workout first, then the meal (iOS 3.3 step 3). */
export function installedOutboxes(): PlanOutboxSource[] {
  const { outboxes } = usePlanBridges.getState();
  return [outboxes.workout, outboxes.meal].filter((source): source is PlanOutboxSource => source !== undefined);
}

/** Every failed item, workouts first. An outbox that throws counts as empty. */
export function failedOutboxItems(): PlanOutboxItem[] {
  return installedOutboxes().flatMap((source) => {
    try {
      return [...source.failedItems()];
    } catch {
      return [];
    }
  });
}

/** Tests: nothing installed. */
export function resetPlanBridgesForTests(): void {
  usePlanBridges.setState({ outboxes: {}, feedback: null, weeklyCheckIn: null });
}
