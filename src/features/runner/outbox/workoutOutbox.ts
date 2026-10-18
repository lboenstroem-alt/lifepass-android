/**
 * The queue of finished workouts this phone still owes the server, per
 * member, in `health/<profileId>/outbox.json`: the Android port of iOS
 * `WorkoutOutbox` (Views/Workout/FinishWorkoutSheet.swift).
 *
 * A FINISHED WORKOUT IS NEVER LOST. A Save that meets no network is queued
 * here (`enqueueWorkout`), with its body, its Idempotency-Key and the moment
 * it was finished, and the runner file goes only after the queue's write was
 * asked for (both writes run in order on the health file store's queue).
 * It is sent again:
 *
 * - when a member's profile loads and whenever the app comes back to the
 *   foreground (./register.ts, the activation hooks: BACKGROUND semantics, a
 *   withdrawn consent reconciles and never presents a sheet), whichever tab
 *   is open, so a member who never opens Plan again still has it sent before
 *   it expires;
 * - on Plan's load, before its read (`flushWorkoutOutbox({ foreground: true })`
 *   through the runner's index), so the day that comes back already counts it.
 *
 * Flushes are serial, one item at a time, and a flush asked for while one
 * runs returns at once: every item carries its own key, so a send that
 * arrives twice is counted once anyway.
 *
 * A queue whose file could not be read is NOT adopted (src/health/localStore.ts
 * `mergeOutbox`): nothing is written over the file, Saves queued meanwhile
 * wait in memory, and the next activation reads it again and merges.
 */
import { create } from 'zustand';

import { newIdempotencyKey, ProblemError } from '../../../api';
import { useHealthStore } from '../../../health/store';
import * as localStore from '../../../health/localStore';
import { mergeOutbox, type ReadOutcome } from '../../../health/localStore';
import type { SessionActionResponse } from '../../../health/models';
import { useAppStore } from '../../../stores/appStore';
import { RunnerAnalytics, type WorkoutOutboxFlushedOutcome } from '../model/analytics';
import type { WorkoutDoneBody } from '../model/performed';
import { readRunnerFailure, type RunnerCallFailure } from '../saveRules';

import { decodeWorkoutOutbox, encodeWorkoutOutbox } from './codec';
import { workoutSessionPosting } from './posting';
import {
  convertedItem,
  isTooOld,
  outboxStep,
  WORKOUT_OUTBOX_CAPACITY,
  type WorkoutOutboxItem,
} from './rules';

export interface WorkoutOutboxState {
  readonly items: readonly WorkoutOutboxItem[];
  /** The member the outbox works for. */
  readonly profileId: string | null;
  /** Whose file `items` was adopted from; writes go only there. */
  readonly loadedProfileId: string | null;
  /** The member whose file could not be read yet: their queue is not adopted, so nothing is written over it. */
  readonly unadoptedProfileId: string | null;
}

/** An item Plan's banner offers a decision on (iOS `PlanOutboxBridge.FailedItem`). */
export interface FailedOutboxItem {
  readonly id: string;
  readonly kind: 'workout';
}

function initialState(): WorkoutOutboxState {
  return { items: [], profileId: null, loadedProfileId: null, unadoptedProfileId: null };
}

export const useWorkoutOutbox = create<WorkoutOutboxState>()(() => initialState());

/** True while a flush runs: a second one asked for meanwhile returns at once. */
let isFlushing = false;

function state(): WorkoutOutboxState {
  return useWorkoutOutbox.getState();
}

// ---------------------------------------------------------------------------
// The file

function readQueue(profileId: string): Promise<ReadOutcome<WorkoutOutboxItem[]>> {
  return localStore.readOutcome('workoutOutbox', profileId, decodeWorkoutOutbox);
}

/** The queue to its member's file; an empty queue leaves no file. Never for a queue that was not adopted. */
function persist(): void {
  const { loadedProfileId, items } = state();
  if (!loadedProfileId) return;
  if (items.length === 0) void localStore.remove('workoutOutbox', loadedProfileId);
  else void localStore.write(encodeWorkoutOutbox(items), 'workoutOutbox', loadedProfileId);
}

/**
 * Take a read as this member's queue. Saves queued while the file could not
 * be read are kept and, once it can be, merged in and written.
 */
function adopt(outcome: ReadOutcome<WorkoutOutboxItem[]>, profileId: string): void {
  const current = state();
  const queuedMeanwhile = current.unadoptedProfileId === profileId ? current.items : [];
  const { items, adopted } = mergeOutbox(outcome, queuedMeanwhile);
  if (!adopted) {
    useWorkoutOutbox.setState({ items, loadedProfileId: null, unadoptedProfileId: profileId });
    return;
  }
  useWorkoutOutbox.setState({ items, loadedProfileId: profileId, unadoptedProfileId: null });
  if (queuedMeanwhile.length > 0) persist();
}

function setItems(items: readonly WorkoutOutboxItem[]): void {
  useWorkoutOutbox.setState({ items });
  persist();
}

function remove(id: string): void {
  setItems(state().items.filter((item) => item.id !== id));
}

function update(id: string, change: (item: WorkoutOutboxItem) => WorkoutOutboxItem): void {
  const items = state().items;
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;
  setItems(items.map((item, at) => (at === index ? change(item) : item)));
}

// ---------------------------------------------------------------------------
// Around the queue: the store, the day, analytics

function toast(key: string): void {
  useHealthStore.getState().setToast(key);
}

/** Whether the member may use health features now (the store's read, else the profile's signal). */
function isEntitled(): boolean {
  return (useHealthStore.getState().today?.access ?? useAppStore.getState().healthAccess) === 'entitled';
}

/** The health store's problem table, for a path no member is watching (or is, for Save as extra). */
function handleProblem(failure: RunnerCallFailure | null, foreground: boolean): void {
  if (failure?.apiError instanceof ProblemError) useHealthStore.getState().handle(failure.apiError, { foreground });
}

/**
 * The answer to a Save, onto the day in memory. A "Do it now" answers with
 * ITS date's row and week, which only replace today's when they are today's.
 */
function apply(response: SessionActionResponse | null): void {
  if (!response) return;
  const health = useHealthStore.getState();
  const sameWeek = (response.week?.weekStartsOn ?? null) === (health.today?.week?.weekStartsOn ?? null);
  health.applyActionResult({
    session: response.session,
    changed: response.changed,
    week: sameWeek ? response.week : null,
    upcoming: response.upcoming,
  });
}

/**
 * After a flush Plan did not ask for: the Today read, because nothing else
 * would bring the session's own date or Home's row up to date. Only for a
 * member with consent who is not a minor.
 */
async function reloadToday(): Promise<void> {
  const app = useAppStore.getState();
  if (!app.profile?.health?.consent || app.healthAccess === 'minor') return;
  await useHealthStore.getState().load({ force: true, profile: app.profile, language: app.language });
}

function track(outcome: WorkoutOutboxFlushedOutcome): void {
  RunnerAnalytics.outboxFlushed(outcome);
}

async function attempt(
  item: WorkoutOutboxItem,
): Promise<{ readonly response: SessionActionResponse | null; readonly failure: RunnerCallFailure | null }> {
  try {
    const response = await workoutSessionPosting().done(item.sessionId, item.body, item.key);
    return { response, failure: null };
  } catch (error) {
    return { response: null, failure: readRunnerFailure(error) };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

/**
 * Load this member's queue (once per member; again while it could not be
 * read). `flushNow`: the activation flush, for the profile load that opens
 * the app.
 */
export async function activateWorkoutOutbox(memberId: string, options: { readonly flushNow?: boolean } = {}): Promise<void> {
  // Ids are compared as the folder names them (lower case).
  const profileId = memberId.toLowerCase();
  useWorkoutOutbox.setState({ profileId });
  if (state().loadedProfileId !== profileId) {
    const outcome = await readQueue(profileId);
    if (state().profileId !== profileId) return;
    // A Save queued while the read was in flight has already read the file
    // itself (`enqueueWorkout`); this older read must not replace it.
    if (state().loadedProfileId !== profileId) adopt(outcome, profileId);
  }
  if (options.flushNow && state().items.length > 0) await flushWorkoutOutbox({ foreground: false });
}

/** The local wipe deleted the file; memory follows. */
export function forgetWorkoutOutbox(): void {
  useWorkoutOutbox.setState(initialState());
}

// ---------------------------------------------------------------------------
// Reading

/**
 * A Save for this session waits on this phone: the session is done as far
 * as the member is concerned, and no door may start it again.
 */
export function hasPendingWorkoutNow(sessionId: string): boolean {
  return state().items.some((item) => item.sessionId === sessionId && item.state === 'pending');
}

/** For React: re-renders when the answer changes. */
export function selectHasPendingWorkout(sessionId: string | null | undefined) {
  return (current: WorkoutOutboxState): boolean =>
    !!sessionId && current.items.some((item) => item.sessionId === sessionId && item.state === 'pending');
}

/** The items that came back `failed` and wait for the member's decision on Plan's banner. */
export function failedWorkoutItems(): FailedOutboxItem[] {
  return state()
    .items.filter((item) => item.state === 'failed')
    .map((item) => ({ id: item.id, kind: 'workout' as const }));
}

// ---------------------------------------------------------------------------
// Writing

/**
 * Queue a Save. False when five are already waiting: the caller keeps
 * `runner.json` and says so ("runner.err.outbox_full") rather than drop
 * anything. The queue's write is asked for before this resolves, so a
 * runner file deleted after it is deleted after the queue is on disk.
 */
export async function enqueueWorkout(options: {
  readonly sessionId: string;
  readonly body: WorkoutDoneBody;
  readonly key: string;
  readonly profileId: string;
  readonly now?: Date;
}): Promise<boolean> {
  const profileId = options.profileId.toLowerCase();
  if (state().loadedProfileId !== profileId) {
    // Never mix two accounts' queues: read what is on disk first.
    useWorkoutOutbox.setState({ profileId });
    const outcome = await readQueue(profileId);
    if (state().loadedProfileId !== profileId) {
      useWorkoutOutbox.setState({ profileId });
      adopt(outcome, profileId);
    }
  }
  if (state().items.length >= WORKOUT_OUTBOX_CAPACITY) return false;
  const item: WorkoutOutboxItem = {
    id: newIdempotencyKey(),
    sessionId: options.sessionId,
    body: options.body,
    key: options.key,
    createdAt: options.now ?? new Date(),
    state: 'pending',
    converted: false,
  };
  setItems([...state().items, item]);
  return true;
}

/** Throw an item away (Plan asks first: "Discard what was saved on this phone?"). */
export function discardWorkoutItem(itemId: string): void {
  if (!state().items.some((item) => item.id === itemId)) return;
  remove(itemId);
}

/** Plan's "Save as extra" on a failed item: a new key, `asExtra`, once. */
export async function saveFailedWorkoutAsExtra(itemId: string): Promise<void> {
  const found = state().items.find((item) => item.id === itemId);
  if (!found) return;
  const { profileId } = state();
  const item = convertedItem(found, newIdempotencyKey());
  update(item.id, () => item);
  const { response, failure } = await attempt(item);
  // Wiped while it was sent: nothing of it is kept or shown.
  if (state().profileId !== profileId) return;
  switch (outboxStep(failure?.kind ?? null, item, { entitled: true, foreground: true })) {
    case 'sent':
    case 'sentAsExtra':
      remove(item.id);
      track('extra');
      apply(response);
      break;
    case 'stop':
      // No network: it waits, as an extra, for the next flush.
      update(item.id, (current) => ({ ...current, state: 'pending' }));
      toast('health.saved_offline');
      break;
    case 'dropChanged':
      remove(item.id);
      toast('health.err.changed');
      break;
    case 'reconcile':
      handleProblem(failure, false);
      break;
    case 'convertToExtra':
    case 'markFailed':
      toast('runner.err.not_saved');
      break;
  }
}

// ---------------------------------------------------------------------------
// Flush

/**
 * Send what waits, oldest first, one at a time. `foreground`: Plan asked (a
 * member is looking at it); otherwise an activation, which never presents a
 * sheet and re-reads Today after sending anything.
 */
export async function flushWorkoutOutbox(options: { readonly foreground: boolean; readonly now?: Date }): Promise<void> {
  const { foreground } = options;
  const now = options.now ?? new Date();
  const { profileId, loadedProfileId } = state();
  if (isFlushing || !profileId || loadedProfileId !== profileId) return;
  isFlushing = true;
  try {
    if (state().items.some((item) => isTooOld(item, now))) {
      setItems(state().items.filter((item) => !isTooOld(item, now)));
      toast('health.err.changed');
    }

    let sentAny = false;
    const pendingIds = state()
      .items.filter((item) => item.state === 'pending')
      .map((item) => item.id);
    for (const id of pendingIds) {
      const found = state().items.find((item) => item.id === id);
      // A wipe or another member's sign-in while the last item was sent.
      if (state().profileId !== profileId || !found || found.state !== 'pending') continue;
      let item = found;
      const entitled = isEntitled();
      let { response, failure } = await attempt(item);
      // The local wipe ran (or another member signed in) while it was sent:
      // that member's queue is gone, and nothing more is sent or applied for
      // it, not even the conversion. (iOS sends the conversion anyway; a
      // workout must not outlive a withdrawal on this phone.)
      if (state().profileId !== profileId) return;
      let step = outboxStep(failure?.kind ?? null, item, { entitled, foreground });
      if (step === 'convertToExtra') {
        item = convertedItem(item, newIdempotencyKey());
        const converted = item;
        update(item.id, () => converted);
        ({ response, failure } = await attempt(item));
        if (state().profileId !== profileId) return;
        step = outboxStep(failure?.kind ?? null, item, { entitled: isEntitled(), foreground });
      }
      if (step === 'stop') break;
      if (step === 'reconcile') {
        // Consent may be gone: the reconcile decides, and nothing is read
        // before it has.
        handleProblem(failure, false);
        return;
      }
      switch (step) {
        case 'sent':
        case 'sentAsExtra':
          remove(item.id);
          track(step === 'sent' ? 'sent' : 'extra');
          apply(response);
          sentAny = true;
          break;
        case 'convertToExtra':
        case 'markFailed':
          update(item.id, (current) => ({ ...current, state: 'failed' }));
          track('failed');
          break;
        case 'dropChanged':
          remove(item.id);
          toast('health.err.changed');
          break;
      }
    }

    // A FINISHED WORKOUT MUST STILL LOOK FINISHED once it leaves the queue:
    // the answer's session went onto Today above, and a flush Plan did not
    // ask for is followed by a Today read. Plan's own is followed by Plan's.
    if (sentAny && !foreground) await reloadToday();
  } finally {
    isFlushing = false;
  }
}

/** Tests: back to a fresh launch (nothing stored is touched). */
export function resetWorkoutOutboxForTests(): void {
  isFlushing = false;
  forgetWorkoutOutbox();
}

/** iOS `WorkoutOutbox.shared`, under its own name. */
export const WorkoutOutbox = {
  activate: activateWorkoutOutbox,
  enqueue: enqueueWorkout,
  hasPending: hasPendingWorkoutNow,
  failedItems: failedWorkoutItems,
  discard: discardWorkoutItem,
  saveAsExtra: saveFailedWorkoutAsExtra,
  flush: flushWorkoutOutbox,
  forget: forgetWorkoutOutbox,
} as const;
