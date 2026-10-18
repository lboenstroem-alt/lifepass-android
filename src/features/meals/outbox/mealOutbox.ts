/**
 * Meals this phone saved while offline, waiting for the server: the Android
 * port of iOS `MealOutbox` (Services/MealOutbox.swift).
 *
 * A new meal saved with no connection goes here with its Idempotency-Key,
 * so a logged meal is never lost and never logged twice. The queue lives in
 * `health/<profileId>/meal-outbox.json` (src/health/localStore.ts: app
 * storage, never backed up), and goes with the rest of the member's health
 * data when the health store wipes it (sign-out, withdrawal, a minor, a
 * deletion): the file with the folder, the memory through ../register.ts.
 *
 * WHEN IT FLUSHES (one at a time, oldest first):
 * - on every activation: a member's first profile read and every return to
 *   the foreground, whatever tab is showing (../register.ts, background: it
 *   never presents anything);
 * - on Plan's load and pull, after the workout outbox (`mealOutboxPlanSource`,
 *   foreground).
 * After a background flush that sent a meal for TODAY, the Today read
 * reloads, so Plan and Home count it.
 *
 * THE FILE IS NEVER WRITTEN OVER BLIND (OutboxAdoption). A queue that could
 * not be read is not adopted: a meal queued meanwhile waits in memory, and
 * the next read merges it with what is on disk (the disk queue first, no id
 * twice) before anything is written.
 *
 * Every read-then-adopt runs on one lock, so an activation and a Save racing
 * for the same file cannot adopt twice or drop each other's meal. iOS reads
 * the file synchronously on the main actor and needs no lock; a JS read is
 * asynchronous, so the lock is what keeps the two in order here.
 */
import { useShallow } from 'zustand/react/shallow';
import { create } from 'zustand';

import { ApiError } from '../../../api';
import { toWireDate } from '../../../api/wire';
import { arrayOf, enumOf, instant, object, req, string, type Reader } from '../../../health/decode';
import * as localStore from '../../../health/localStore';
import { mergeOutbox, type ReadOutcome } from '../../../health/localStore';
import { useHealthStore } from '../../../health/store';
import { todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import { mealApi } from '../api/mealApi';
import { refreshMineFoods } from '../foodsCache/foodsCache';
import { decodeMealCreateBody } from '../types/decode';
import { newLocalId } from '../types/draftFactory';
import { encodeMealCreateBodyForDisk } from '../types/encode';
import type { MealCreateBody } from '../types/models';

import { isTooOld, MEAL_OUTBOX_CAPACITY, mealOutboxStep, type MealOutboxItem, type MealOutboxState } from './rules';

/** The toast a dropped or expired meal raises (the health store's toast; the Plan and Home hosts show it). */
export const MEAL_OUTBOX_CHANGED_TOAST = 'health.err.changed';

export interface MealOutboxStoreState {
  /** The queue in memory, oldest first. */
  readonly items: readonly MealOutboxItem[];
}

/** The queue, for screens: `useMealOutbox((s) => s.items.length)`. */
export const useMealOutbox = create<MealOutboxStoreState>()(() => ({ items: [] }));

// ---------------------------------------------------------------------------
// Whose queue this is

/** The member the outbox works for. */
let profileId: string | null = null;
/** The member whose file was read and adopted; writes go only to this member's file. */
let loadedProfileId: string | null = null;
/** The member whose file could not be read yet: nothing is written over it. */
let unadoptedProfileId: string | null = null;
let isFlushing = false;
/** Bumped by every wipe: a read or a send in flight for the member who left lands nowhere. */
let epoch = 0;

let lock: Promise<unknown> = Promise.resolve();

/** Runs `work` after every locked operation before it; its own failure never blocks the next. */
function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = lock.then(work, work);
  lock = run.catch(() => undefined);
  return run;
}

/** Profile ids are lower-case UUIDs; the folder name is too (src/health/localStore.ts). */
function normalised(id: string): string {
  return id.trim().toLowerCase();
}

function items(): readonly MealOutboxItem[] {
  return useMealOutbox.getState().items;
}

function setItems(next: readonly MealOutboxItem[]): void {
  useMealOutbox.setState({ items: next });
}

// ---------------------------------------------------------------------------
// The file

const outboxState = enumOf<MealOutboxState>(['pending', 'failed']);

const decodeOutboxItem: Reader<MealOutboxItem> = (value, path) => {
  const json = object(value, path);
  const state = req(json, 'state', path, outboxState);
  if (state === 'unknown') throw new Error(`${path}.state`);
  return {
    id: req(json, 'id', path, string),
    body: req(json, 'body', path, decodeMealCreateBody),
    key: req(json, 'key', path, string),
    createdAt: req(json, 'createdAt', path, instant),
    state,
  };
};

/**
 * The queue file: a list, read entry by entry. One damaged entry is dropped
 * and the others stand; iOS decodes the list whole, so one bad entry there
 * made the file unreadable as a cache and it was deleted with every meal on
 * it. Anything that is not a list throws (the store then treats the file as
 * gone).
 */
function decodeQueue(json: unknown): MealOutboxItem[] {
  const entries = arrayOf((value) => value)(json, 'mealOutbox');
  const result: MealOutboxItem[] = [];
  entries.forEach((value, index) => {
    try {
      result.push(decodeOutboxItem(value, `mealOutbox[${index}]`));
    } catch {
      // Dropped; the queue stands.
    }
  });
  return result;
}

/** An entry as it is kept on disk: the request exactly as it will be sent. */
export function encodeOutboxItem(item: MealOutboxItem): Record<string, unknown> {
  return {
    id: item.id,
    body: encodeMealCreateBodyForDisk(item.body),
    key: item.key,
    createdAt: toWireDate(item.createdAt),
    state: item.state,
  };
}

/** Reads a queue back (the round trip the tests check). */
export function decodeOutboxQueue(json: unknown): MealOutboxItem[] {
  return decodeQueue(json);
}

function persist(): void {
  const id = loadedProfileId;
  if (!id) return;
  const current = items();
  if (current.length === 0) {
    // An empty queue leaves no file.
    void localStore.remove('mealOutbox', id);
  } else {
    void localStore.write(JSON.stringify(current.map(encodeOutboxItem)), 'mealOutbox', id);
  }
}

/** Take a read as this member's queue (`OutboxAdoption`). */
function adopt(outcome: ReadOutcome<readonly MealOutboxItem[]>, id: string): void {
  const queuedMeanwhile = unadoptedProfileId === id ? items() : [];
  const { items: merged, adopted } = mergeOutbox(outcome, queuedMeanwhile);
  setItems(merged);
  if (!adopted) {
    loadedProfileId = null;
    unadoptedProfileId = id;
    return;
  }
  loadedProfileId = id;
  unadoptedProfileId = null;
  if (queuedMeanwhile.length > 0) persist();
}

/** Inside the lock: make the queue in memory this member's, reading the file if it is not yet. */
async function adoptLocked(id: string): Promise<void> {
  if (loadedProfileId === id) return;
  const at = epoch;
  const outcome = await localStore.readOutcome('mealOutbox', id, decodeQueue);
  // A wipe ran while the file was read: what was read is gone.
  if (at !== epoch || loadedProfileId === id) return;
  adopt(outcome, id);
}

// ---------------------------------------------------------------------------
// Lifecycle

/**
 * Load the queue for this member, then (with `flushNow`) send what waits.
 * Called on every activation and by Plan before its own flush: a meal saved
 * offline must be sent even if the member never opens Plan again.
 */
export async function activateMealOutbox(options: { readonly profileId: string; readonly flushNow?: boolean }): Promise<void> {
  const id = normalised(options.profileId);
  profileId = id;
  await locked(async () => {
    // Another member's activation came first: theirs is the queue now.
    if (profileId !== id) return;
    await adoptLocked(id);
  });
  if (profileId !== id) return;
  if (options.flushNow && items().length > 0) await flushMealOutbox({ foreground: false });
}

/**
 * Make sure the queue in memory is this member's, read from disk if it is
 * not yet. Also the second chance for a queue whose file could not be read.
 */
export function adoptMealQueue(memberId: string): Promise<void> {
  const id = normalised(memberId);
  profileId = id;
  return locked(() => adoptLocked(id));
}

/**
 * Forget everything in memory (the local wipe: the file goes with the
 * health folder). A read or a send still in flight for the member who left
 * lands nowhere.
 */
export function resetMealOutboxMemory(): void {
  epoch += 1;
  profileId = null;
  loadedProfileId = null;
  unadoptedProfileId = null;
  setItems([]);
}

/** The member the outbox last worked for, if any (the sign-out cleaner's fallback). */
export function mealOutboxProfileId(): string | null {
  return profileId;
}

// ---------------------------------------------------------------------------
// Reading

/** Ten are waiting: a new Save keeps its tray (`meal.outbox.full`). */
export function isMealOutboxFull(): boolean {
  return items().length >= MEAL_OUTBOX_CAPACITY;
}

/** `isMealOutboxFull` as a hook (the capture page's Save button). */
export function useIsMealOutboxFull(): boolean {
  return useMealOutbox((state) => state.items.length >= MEAL_OUTBOX_CAPACITY);
}

/** Queued meals for one date, oldest first: the Diary's and Plan's "waiting to sync" rows. */
export function pendingMealsOn(date: string, queue: readonly MealOutboxItem[] = items()): MealOutboxItem[] {
  return queue.filter((item) => item.body.logDate === date).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The meals the server refused, waiting for the member to discard them (Plan's banner). */
export function failedMealItems(queue: readonly MealOutboxItem[] = items()): MealOutboxItem[] {
  return queue.filter((item) => item.state === 'failed');
}

/** `pendingMealsOn` as a hook, redrawn when the queue changes. */
export function usePendingMeals(date: string): MealOutboxItem[] {
  return useMealOutbox(useShallow((state) => pendingMealsOn(date, state.items)));
}

/** `failedMealItems` as a hook. */
export function useFailedMealItems(): MealOutboxItem[] {
  return useMealOutbox(useShallow((state) => failedMealItems(state.items)));
}

// ---------------------------------------------------------------------------
// Writing

/**
 * Queue a new meal with the key minted at Save. False when ten are already
 * waiting (the caller keeps the tray rather than drop anything), or when the
 * member's data was wiped while their queue was being read.
 */
export function enqueueMeal(body: MealCreateBody, key: string, memberId: string, now: Date = new Date()): Promise<boolean> {
  const id = normalised(memberId);
  profileId = id;
  return locked(async () => {
    // Never mix two accounts' queues: read what is on disk first.
    await adoptLocked(id);
    if (loadedProfileId !== id && unadoptedProfileId !== id) return false;
    if (items().length >= MEAL_OUTBOX_CAPACITY) return false;
    setItems([...items(), { id: newLocalId(), body, key, createdAt: now, state: 'pending' }]);
    persist();
    track('meal_outbox_queued');
    return true;
  });
}

/** Throw one away (Plan asks first). */
export function discardMealOutboxItem(itemId: string): void {
  if (!items().some((item) => item.id === itemId)) return;
  remove(itemId);
}

function remove(itemId: string): void {
  setItems(items().filter((item) => item.id !== itemId));
  persist();
}

function markFailed(itemId: string): void {
  if (!items().some((item) => item.id === itemId)) return;
  setItems(items().map((item) => (item.id === itemId ? { ...item, state: 'failed' as const } : item)));
  persist();
}

// ---------------------------------------------------------------------------
// Flush

/** The member holds a membership the health routes take (iOS `entitled`). */
function isEntitled(): boolean {
  const access = useHealthStore.getState().today?.access ?? useAppStore.getState().healthAccess;
  return access === 'entitled';
}

/**
 * Send what is waiting, one at a time, oldest first. Returns at once while a
 * flush is already running, and before this member's queue is adopted.
 * `foreground`: a member's own action (Plan); everything else is background
 * and never presents a sheet.
 */
export async function flushMealOutbox(options: { readonly foreground: boolean; readonly now?: Date }): Promise<void> {
  const id = profileId;
  if (isFlushing || !id || loadedProfileId !== id) return;
  isFlushing = true;
  const at = epoch;
  try {
    const now = options.now ?? new Date();
    if (items().some((item) => isTooOld(item, now))) {
      setItems(items().filter((item) => !isTooOld(item, now)));
      persist();
      useHealthStore.getState().setToast(MEAL_OUTBOX_CHANGED_TOAST);
    }

    let sentToday = false;
    const today = todayServerDay(now);
    const queue = items()
      .filter((item) => item.state === 'pending')
      .map((item) => item.id);
    sending: for (const itemId of queue) {
      if (at !== epoch || profileId !== id) continue;
      const item = items().find((entry) => entry.id === itemId);
      if (!item) continue;
      let failure: ApiError | null = null;
      try {
        await mealApi().createMeal(item.body, item.key);
      } catch (error) {
        // A cancellation, or something that is not an API answer at all: stop, keep everything.
        if (!(error instanceof ApiError) || error.isCancellation) break;
        failure = error;
      }
      // Wiped while the meal was on its way: nothing here is theirs any more.
      if (at !== epoch) break;
      switch (mealOutboxStep(failure, { foreground: options.foreground, entitled: isEntitled() })) {
        case 'sent':
          remove(item.id);
          track('meal_outbox_flushed', { outcome: 'sent' });
          if (item.body.logDate === today) sentToday = true;
          refreshMineFoods();
          break;
        case 'drop':
          remove(item.id);
          useHealthStore.getState().setToast(MEAL_OUTBOX_CHANGED_TOAST);
          break;
        case 'markFailed':
          markFailed(item.id);
          track('meal_outbox_flushed', { outcome: 'failed' });
          break;
        case 'reconcile':
          // Never a sheet: the health store asks for the profile, and the
          // reconcile wipes only if consent really is gone.
          if (failure) useHealthStore.getState().handle(failure, { foreground: false });
          return;
        case 'stop':
          break sending;
      }
    }

    // Plan reads right after its own flush; an activation flush has to bring
    // today's totals (Plan and Home) up to date itself.
    if (sentToday && !options.foreground && at === epoch) {
      const app = useAppStore.getState();
      if (app.profile?.health?.consent && app.healthAccess !== 'minor') {
        await useHealthStore.getState().load({ force: true, profile: app.profile, language: app.language });
      }
    }
  } finally {
    isFlushing = false;
  }
}

// ---------------------------------------------------------------------------
// Plan's failed-item banner (the meal half of iOS `PlanOutboxBridge`)

/** A queued meal the server would not take, as Plan's banner lists it. */
export interface MealOutboxPlanItem {
  readonly id: string;
  readonly kind: 'meal';
}

/**
 * Plan's view of this outbox, shaped as PLAN-1's `PlanOutboxSource`
 * (src/features/plan/shell/bridges.ts) so it installs as it is:
 *
 *   installPlanOutbox('meal', mealOutboxPlanSource);
 *
 * Plan flushes the workout outbox first, then this; the banner lists both
 * halves' failed items; a meal offers Discard only (after Plan's
 * confirmation, which reports `outbox_item_discarded`).
 */
export const mealOutboxPlanSource = {
  /**
   * Plan's load and pull: the member's own action, so a consent refusal is
   * marked failed for them to decide about. The queue is this member's
   * first (iOS PlanView calls `MealOutbox.activate` before the bridge's
   * flush).
   */
  async flush(): Promise<void> {
    const memberId = useAppStore.getState().profile?.id;
    if (memberId) await activateMealOutbox({ profileId: memberId });
    await flushMealOutbox({ foreground: true });
  },
  failedItems(): readonly MealOutboxPlanItem[] {
    return failedMealItems().map((item) => ({ id: item.id, kind: 'meal' as const }));
  },
  discard(item: { readonly id: string; readonly kind: string }): Promise<void> {
    if (item.kind === 'meal') discardMealOutboxItem(item.id);
    return Promise.resolve();
  },
  /** Called when the queue changes (an item failed, or went through in the background). */
  subscribe(listener: () => void): () => void {
    return useMealOutbox.subscribe(() => listener());
  },
};

// ---------------------------------------------------------------------------
// Tests

/** Back to a fresh launch: memory only, nothing on disk is touched. */
export function resetMealOutboxForTests(): void {
  resetMealOutboxMemory();
  isFlushing = false;
  lock = Promise.resolve();
}
