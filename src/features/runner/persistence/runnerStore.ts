/**
 * `runner.json`: one in-progress workout per member, on F7's health file
 * store (src/health/localStore.ts: the app's internal storage, never backed
 * up, one folder per profile, every disk touch on one serial queue). The
 * Android port of iOS `RunnerStore` (Views/Workout/WorkoutRunnerView.swift).
 *
 * WHAT IS WRITTEN, AND WHEN. The runner writes the whole state on every
 * change (a tick, a step, a swap, a skip, a rest started or moved, a timer),
 * and every 30 seconds while the active clock runs (`clockWriteDue`), so a
 * process that dies does not count the hours after it. It holds the full
 * session, so a workout resumes offline and for a past date the Today read
 * no longer carries.
 *
 * A file of another version is ignored rather than half-read; a file that no
 * longer decodes is deleted by the store and reads as none.
 */
import { todayServerDay } from '../../../i18n/format';
import * as localStore from '../../../health/localStore';
import type { ReadOutcome } from '../../../health/localStore';
import { decodeRunnerState, encodeRunnerState } from '../model/codec';
import { isExpired } from '../model/state';
import { RUNNER_STATE_VERSION, type RunnerState } from '../model/types';

import { runnerWipeEpoch, wipedSince } from './fence';
import { RunnerProgressIndex, useRunnerProgress } from './progressIndex';

/** How often a running clock is written down when nothing else changed. */
export const CLOCK_WRITE_INTERVAL_MS = 30_000;

/** What the file holds, absent and unreadable told apart (the launch rule needs both). */
export function readRunnerOutcome(profileId: string): Promise<ReadOutcome<RunnerState>> {
  return localStore.readOutcome('runner', profileId, decodeRunnerState);
}

/** The workout saved for this member, when it is of the current version. */
export async function loadRunner(profileId: string): Promise<RunnerState | null> {
  const outcome = await readRunnerOutcome(profileId);
  if (outcome.kind !== 'value' || outcome.value.version !== RUNNER_STATE_VERSION) return null;
  return outcome.value;
}

export interface RunnerSaveOptions {
  /**
   * The wipe epoch the runner screen opened in (`runnerWipeEpoch()`, ./fence.ts).
   * When a local wipe has run since, the workout was discarded: nothing is
   * written and the Resume row is not noted. The screen passes it on every
   * save; the wipe also tells it to close (`onRunnerWiped`).
   */
  readonly since?: number;
}

/**
 * Queues the write of `state` and notes it for Plan's Resume row. Resolves
 * to whether it was written; the runner need not wait (writes run in the
 * order they were asked for).
 */
export function saveRunner(state: RunnerState, profileId: string, options: RunnerSaveOptions = {}): Promise<boolean> {
  if (options.since !== undefined && wipedSince(options.since)) return Promise.resolve(false);
  const written = localStore.write(encodeRunnerState(state), 'runner', profileId);
  RunnerProgressIndex.note(state, profileId.toLowerCase());
  return written;
}

/**
 * The runner's own save (iOS `WorkoutRunnerModel.persist`): a running clock
 * is stamped as seen now, then the state is saved. Returns the stamped state
 * for the screen to keep.
 */
export function persistRunner(
  state: RunnerState,
  profileId: string,
  now: Date = new Date(),
  options: RunnerSaveOptions = {},
): RunnerState {
  const stamped = state.clockRunningSince ? { ...state, lastSeenAt: now } : state;
  void saveRunner(stamped, profileId, options);
  return stamped;
}

/** A running clock not written for 30 seconds is due a write (the tick asks every half second). */
export function clockWriteDue(state: RunnerState, now: Date): boolean {
  return state.clockRunningSince !== null && now.getTime() - state.lastSeenAt.getTime() >= CLOCK_WRITE_INTERVAL_MS;
}

/** Queues the removal of the file and clears Plan's Resume row. */
export function deleteRunner(profileId: string): Promise<void> {
  const removed = localStore.remove('runner', profileId);
  RunnerProgressIndex.clear();
  return removed;
}

/**
 * Read the file into Plan's Resume row; delete it when it outlived its day
 * (the day after its session). Run on a profile load and on Plan's load.
 */
export async function refreshRunnerProgress(memberId: string, today: string = todayServerDay()): Promise<void> {
  const profileId = memberId.toLowerCase();
  const epoch = runnerWipeEpoch();
  useRunnerProgress.setState({ profileId });
  const state = await loadRunner(profileId);
  // The local wipe ran while the file was read: what was read is gone.
  if (wipedSince(epoch)) return;
  if (!state) {
    if (useRunnerProgress.getState().profileId === profileId) RunnerProgressIndex.clear();
    return;
  }
  // Another member signed in while the file was read.
  if (useRunnerProgress.getState().profileId !== profileId) return;
  if (isExpired(state, today)) {
    await deleteRunner(profileId);
    return;
  }
  RunnerProgressIndex.note(state, profileId);
}

/**
 * The cold-launch check (iOS `LaunchTab.hasResumableWorkout`): a workout of
 * the current shape that has not outlived its day is resumable; a file that
 * exists but cannot be read counts too (`sessionId: null`), so the stored
 * tab is kept when in doubt. An expired file is not offered (Plan deletes
 * it); nothing here deletes.
 */
export async function resumableWorkoutFor(
  profileId: string,
  today: string = todayServerDay(),
): Promise<{ readonly sessionId: string | null } | null> {
  const outcome = await readRunnerOutcome(profileId);
  switch (outcome.kind) {
    case 'value':
      return outcome.value.version === RUNNER_STATE_VERSION && !isExpired(outcome.value, today)
        ? { sessionId: outcome.value.sessionId }
        : null;
    case 'unreadable':
      return { sessionId: null };
    case 'absent':
      return null;
  }
}
