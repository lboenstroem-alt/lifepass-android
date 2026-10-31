/**
 * Which session has a workout in progress, and where it is: the Android port
 * of iOS `RunnerProgressIndex` (Views/Workout/WorkoutRunnerView.swift).
 *
 * Plan's Today card reads it on every render ("Workout in progress ·
 * exercise 2 of 5" with Resume in place of Start, or "In progress: Full body
 * strength · exercise 2 of 5" for a workout another day's session left), so
 * it is held in memory and refreshed from `runner.json` only on a profile
 * load and on Plan's load (`refreshRunnerProgress`, ./runnerStore.ts). The
 * runner notes every save here.
 *
 *   const progress = useRunnerProgress(selectRunnerProgressFor(session.id));
 */
import { create } from 'zustand';

import type { RunnerState } from '../model/types';

export interface RunnerProgressSummary {
  readonly sessionId: string;
  /** The exercise on screen, 1-based, at most `total`. */
  readonly exercise: number;
  /** At least 1. */
  readonly total: number;
  /** The session's title and date, so Today can name a workout in progress that belongs to another day. */
  readonly title: string | null;
  readonly scheduledFor: string | null;
}

export interface RunnerProgressState {
  readonly summary: RunnerProgressSummary | null;
  /** Whose file the summary was read from. */
  readonly profileId: string | null;
}

export const useRunnerProgress = create<RunnerProgressState>()(() => ({ summary: null, profileId: null }));

/** The workout in progress for `sessionId`, or null. */
export function selectRunnerProgressFor(sessionId: string | null | undefined) {
  return (state: RunnerProgressState): RunnerProgressSummary | null =>
    sessionId && state.summary?.sessionId === sessionId ? state.summary : null;
}

/**
 * The workout in progress when it belongs to ANOTHER session than
 * `sessionId`: Today names it, so a member who left yesterday's workout for
 * later still finds it from today's card.
 */
export function selectRunnerProgressOtherThan(sessionId: string | null | undefined) {
  return (state: RunnerProgressState): RunnerProgressSummary | null =>
    state.summary && state.summary.sessionId !== sessionId ? state.summary : null;
}

function sameSummary(a: RunnerProgressSummary | null, b: RunnerProgressSummary | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sessionId === b.sessionId &&
    a.exercise === b.exercise &&
    a.total === b.total &&
    a.title === b.title &&
    a.scheduledFor === b.scheduledFor
  );
}

/** The summary of a runner. */
export function progressSummaryOf(state: RunnerState): RunnerProgressSummary {
  const total = Math.max(1, state.exercises.length);
  return {
    sessionId: state.sessionId,
    exercise: Math.min(state.index + 1, total),
    total,
    title: state.session.title,
    scheduledFor: state.session.scheduledFor,
  };
}

export const RunnerProgressIndex = {
  /** The summary now (outside React). */
  summaryFor(sessionId: string | null | undefined): RunnerProgressSummary | null {
    return selectRunnerProgressFor(sessionId)(useRunnerProgress.getState());
  },

  summaryOtherThan(sessionId: string | null | undefined): RunnerProgressSummary | null {
    return selectRunnerProgressOtherThan(sessionId)(useRunnerProgress.getState());
  },

  /** A runner was saved: its summary is the one Plan shows. */
  note(state: RunnerState, profileId: string): void {
    const next = progressSummaryOf(state);
    const current = useRunnerProgress.getState();
    if (current.profileId === profileId && sameSummary(current.summary, next)) return;
    useRunnerProgress.setState({ summary: next, profileId });
  },

  clear(): void {
    if (useRunnerProgress.getState().summary !== null) useRunnerProgress.setState({ summary: null });
  },

  /** Forget everything, whose file it was included (the local wipe). */
  reset(): void {
    useRunnerProgress.setState({ summary: null, profileId: null });
  },
} as const;
