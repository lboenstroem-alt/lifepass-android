/**
 * "Skip this workout" with a reason (`OP-20`, 7.8): the Android port of iOS
 * `WorkoutRunnerModel.skipWorkout(reason:)` (Views/Workout/WorkoutRunnerView.swift).
 *
 * Offered from the Leave dialog only before any set is done, on a session
 * the server says can be skipped, and online (the screen decides; see
 * `controller.canSkipWorkout`). A member who did something saves it instead.
 *
 * `POST /health/sessions/{id}` `{ action: 'skip', skipReason }` under a fresh
 * key. Went through: counted (never with the reason), the answer goes onto
 * the day, runner.json goes, the runner closes. Otherwise:
 *   no network                 "This needs a connection." (the sheet stays)
 *   changed elsewhere, the
 *   gate, consent, a reconcile the store handles it, the runner closes and
 *                              Plan reads again
 *   anything else              "Something went wrong. Please try again."
 *   cancelled, signed out      nothing to say
 */
import { newIdempotencyKey } from '../../../api/idempotency';
import { useHealthStore, type HealthProblemOutcome } from '../../../health/store';
import type { SessionActionResponse, SkipReason } from '../../../health/models';
import { errorDescription, track } from '../../../lib/analytics';
import { RunnerAnalytics } from '../model/analytics';
import { workoutSessionPosting, type WorkoutSessionPosting } from '../outbox/posting';
import { readRunnerFailure } from '../saveRules';
import type { RunnerController } from '../screen/controller';
import { applyRunnerAnswer } from '../finish/applyAnswer';

/** The member's four reasons, in the No energy sheet's order and words. */
export const SKIP_WORKOUT_REASONS: readonly SkipReason[] = ['time', 'tired', 'sore', 'other'];

/** The store's answers that change what Plan shows: the runner closes so Plan can read again. */
const CLOSES_THE_RUNNER: readonly HealthProblemOutcome[] = ['changedElsewhere', 'gate', 'presentConsent', 'reconciling'];

export interface SkipWorkoutSnapshot {
  readonly isSkipping: boolean;
  /** Why the last Skip did not go through, or null. */
  readonly errorKey: string | null;
}

export interface SkipWorkoutDependencies {
  readonly posting?: () => WorkoutSessionPosting;
  readonly mintKey?: () => string;
}

type Listener = () => void;

export class SkipWorkoutFlow {
  private snapshot: SkipWorkoutSnapshot = { isSkipping: false, errorKey: null };
  private readonly listeners = new Set<Listener>();
  private readonly posting: () => WorkoutSessionPosting;
  private readonly mintKey: () => string;

  constructor(
    private readonly controller: RunnerController,
    dependencies: SkipWorkoutDependencies = {},
  ) {
    this.posting = dependencies.posting ?? workoutSessionPosting;
    this.mintKey = dependencies.mintKey ?? newIdempotencyKey;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SkipWorkoutSnapshot => this.snapshot;

  private publish(patch: Partial<SkipWorkoutSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** A fresh sheet: no error from an earlier one. */
  reset(): void {
    if (!this.snapshot.isSkipping && this.snapshot.errorKey !== null) this.publish({ errorKey: null });
  }

  async skip(reason: SkipReason): Promise<void> {
    if (this.snapshot.isSkipping || this.controller.isClosed) return;
    this.publish({ isSkipping: true, errorKey: null });
    let response: SessionActionResponse;
    // Only the request itself: what follows an answer is never read as a failed Skip.
    try {
      response = await this.posting().skip(this.controller.state.sessionId, reason, this.mintKey());
    } catch (error) {
      this.publish({ isSkipping: false });
      this.failed(error);
      return;
    }
    this.publish({ isSkipping: false });
    // A sign-out wiped the workout meanwhile: the runner has closed.
    if (this.controller.isClosed) return;
    // The server has skipped the session: whatever goes wrong on this phone
    // now, the runner closes as skipped (Plan's read after it repairs the day).
    try {
      this.controller.endRunner();
      RunnerAnalytics.workoutSkipped();
      applyRunnerAnswer(response);
    } catch (error) {
      track('service_error', { op: 'runner_apply_answer', error: errorDescription(error) });
    }
    this.controller.close({ kind: 'skipped', response });
  }

  private failed(error: unknown): void {
    if (this.controller.isClosed) return;
    const failure = readRunnerFailure(error);
    switch (failure.kind.kind) {
      case 'cancelled':
      case 'notAuthenticated':
        return;
      case 'offline':
        this.publish({ errorKey: 'health.offline.action_hint' });
        return;
      case 'problem':
      case 'other': {
        if (failure.apiError) {
          const outcome = useHealthStore.getState().handle(failure.apiError, { foreground: true });
          if (CLOSES_THE_RUNNER.includes(outcome)) {
            this.controller.close({ kind: 'needsReload' });
            return;
          }
        }
        this.publish({ errorKey: 'common.error_body' });
        return;
      }
    }
  }
}

const flows = new WeakMap<RunnerController, SkipWorkoutFlow>();

/** The skip-workout flow of this runner (one per runner, made on first use). */
export function skipWorkoutFlowFor(controller: RunnerController, dependencies?: SkipWorkoutDependencies): SkipWorkoutFlow {
  let flow = flows.get(controller);
  if (!flow) {
    flow = new SkipWorkoutFlow(controller, dependencies);
    flows.set(controller, flow);
  }
  return flow;
}
