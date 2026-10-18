/**
 * The three session calls the runner makes, behind one seam: the Android port
 * of iOS `WorkoutSessionPosting` (Views/Workout/WorkoutRunnerView.swift).
 *
 * The live one posts `POST /health/sessions/{id}` through the API client
 * (no HTTP cache for health traffic, the caller's Idempotency-Key). Tests and
 * development fixtures stand in for the server with `setWorkoutSessionPosting`.
 *
 * A PERFORMED WORKOUT IS SENT FROM HERE, not through the health API's
 * `SessionAction.done` (that one is Plan's "Mark done", with no sets).
 */
import { apiPost } from '../../../api';
import { HEALTH_READ_TIMEOUT_MS, postSessionAction, SessionAction } from '../../../health/api';
import { decodeSessionActionResponse, type SessionActionResponse, type SkipReason } from '../../../health/models';
import type { WorkoutDoneBody } from '../model/performed';

export interface WorkoutSessionPosting {
  /** Save: the runner's `done` body, with every set. */
  done(sessionId: string, body: WorkoutDoneBody, idempotencyKey: string): Promise<SessionActionResponse>;
  /** Skip the whole session, with the member's reason. */
  skip(sessionId: string, reason: SkipReason, idempotencyKey: string): Promise<SessionActionResponse>;
  /** A swap that also applies to the rest of the plan (`scope: future`). */
  swapForRestOfPlan(
    sessionId: string,
    exerciseId: string,
    toExerciseId: string,
    idempotencyKey: string,
  ): Promise<SessionActionResponse>;
}

/** The real one. */
export const liveWorkoutSessionPosting: WorkoutSessionPosting = {
  done(sessionId, body, idempotencyKey) {
    // iOS `HealthService.runnerDone`: the health client's 20-second default.
    return apiPost(`/health/sessions/${encodeURIComponent(sessionId)}`, body, {
      idempotencyKey,
      timeoutMs: HEALTH_READ_TIMEOUT_MS,
      decode: decodeSessionActionResponse,
    });
  },
  skip(sessionId, reason, idempotencyKey) {
    return postSessionAction(sessionId, SessionAction.skip(reason), idempotencyKey);
  },
  swapForRestOfPlan(sessionId, exerciseId, toExerciseId, idempotencyKey) {
    return postSessionAction(sessionId, SessionAction.swap(exerciseId, toExerciseId), idempotencyKey);
  },
};

let current: WorkoutSessionPosting = liveWorkoutSessionPosting;

/** The posting in use. */
export function workoutSessionPosting(): WorkoutSessionPosting {
  return current;
}

/** Stand in for the server (tests, development fixtures); null puts the live one back. */
export function setWorkoutSessionPosting(posting: WorkoutSessionPosting | null): void {
  current = posting ?? liveWorkoutSessionPosting;
}
