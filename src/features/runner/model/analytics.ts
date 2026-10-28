/**
 * The runner's analytics events, in one place: the Android port of the
 * runner's `AnalyticsService.track` calls (Views/Workout/WorkoutRunnerView.swift,
 * FinishWorkoutSheet.swift).
 *
 * NO HEALTH VALUE IS EVER A PARAM: never an exercise, a weight, a rep count,
 * a feeling or a skip reason. Only the fixed words iOS sends (`kind`,
 * `entry`, `future`, `outcome`, `feeling_given`, `choice`, `action`), which
 * src/lib/analytics.ts's allow-list accepts. `workout_started` and
 * `workout_outbox_flushed` say a member USES the plan, which is itself health
 * information: first-party ingestion only (see src/lib/analytics.ts).
 *
 * The rest-timer notification's `notification_opened { kind: resttimer }` is
 * sent by the notification router (src/app/notificationRouter.ts).
 */
import { track } from '../../../lib/analytics';
import type { SessionKind } from '../../../api/profile';

import type { RunnerEntry } from './types';

/** `workout_finished.outcome`. */
export type WorkoutFinishedOutcome = 'saved' | 'extra' | 'outbox' | 'not_active';

/** `workout_outbox_flushed.outcome`. */
export type WorkoutOutboxFlushedOutcome = 'sent' | 'extra' | 'failed';

/** `workout_left.choice`. */
export type WorkoutLeftChoice = 'later' | 'discard';

export const RunnerAnalytics = {
  /** The runner opened (once per screen): the session's kind (strength when it names none) and where from. */
  started(kind: SessionKind | null, entry: RunnerEntry): void {
    track('workout_started', { kind: kind ?? 'strength', entry });
  },
  /** A swap; `future` when it also applies to the rest of the plan (never for the way back). */
  exerciseSwapped(future: boolean): void {
    track('workout_exercise_swapped', { future });
  },
  exerciseSkipped(): void {
    track('workout_exercise_skipped');
  },
  /** The whole session skipped from the runner. The reason is NOT sent. */
  workoutSkipped(): void {
    track('workout_skipped');
  },
  /** Save's answer, and whether a feeling was picked (never which). */
  finished(outcome: WorkoutFinishedOutcome, feelingGiven: boolean): void {
    track('workout_finished', { outcome, feeling_given: feelingGiven });
  },
  left(choice: WorkoutLeftChoice): void {
    track('workout_left', { choice });
  },
  outboxFlushed(outcome: WorkoutOutboxFlushedOutcome): void {
    track('workout_outbox_flushed', { outcome });
  },
} as const;
