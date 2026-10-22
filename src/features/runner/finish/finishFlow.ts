/**
 * Finishing a workout (`ios-ux.md` 7.7): the finish sheet's view model, the
 * Android port of iOS `WorkoutRunnerModel.prepareFinish`, `save`,
 * `saveAsExtra`, `send` and `queueOffline` (Views/Workout/WorkoutRunnerView.swift,
 * FinishWorkoutSheet.swift).
 *
 * WHAT IS SENT. `{ action: 'done', minutes, feeling?, performed?,
 * clientCompletedAt, asExtra? }` (../model/performed.ts), every empty member
 * left out, under the Save's Idempotency-Key.
 *
 * ONE KEY PER SAVE, ONE MOMENT PER WORKOUT. The key is minted when the sheet
 * opens (only when there is none) and written to `runner.json` with the
 * workout, so a Save that timed out after the server recorded it is sent
 * again under the SAME key, after a relaunch too, and counted once. The
 * moment (`clientCompletedAt`) is fixed at the first Save attempt and written
 * down BEFORE the request goes out; every retry, the outbox item and an
 * extra carry it. Only "Save as extra" (a new Save of the same workout) and
 * the one `idempotency_key_reused` retry mint a new key.
 *
 * WHAT AN ANSWER MEANS is RUN-1's table (../saveRules.ts); this carries it
 * out:
 *   saved              the answer goes onto the day, runner.json goes, close
 *   no network         queued in the outbox (on disk first), runner.json goes,
 *                      "Saved on this phone...", close; a full queue or one
 *                      that cannot be written keeps everything and says so
 *   moved elsewhere    "Save what you did as an extra workout?"
 *   plan not active    the sheet says so; Save is greyed; "Finish later today"
 *   reused key         a new key, once, and the Save again
 *   the gate           the store shows it; the file is KEPT; close
 *   consent            the consent sheet when the member is entitled (Save
 *                      runs again after it), else the reconcile and close
 *   anything else      the sheet says why, the file stays
 *
 * One flow per runner (`finishFlowFor`), so the feeling picked survives a
 * "Keep going" and the sheet opening again, as iOS keeps it on the model.
 */
import { newIdempotencyKey } from '../../../api/idempotency';
import { useHealthStore } from '../../../health/store';
import type { Feeling } from '../../../health/models';
import { RunnerAnalytics, type WorkoutFinishedOutcome } from '../model/analytics';
import { runnerDoneBody, type WorkoutDoneBody } from '../model/performed';
import { ensureFinishKey, suggestedMinutes, withCompletedAt, withFinishKey } from '../model/state';
import { workoutSessionPosting, type WorkoutSessionPosting } from '../outbox/posting';
import { queueWorkoutSave, type QueueWorkoutOptions, type WorkoutQueueOutcome } from '../outbox/workoutOutbox';
import { runnerWipeEpoch } from '../persistence/fence';
import { readRunnerFailure, runnerSaveOutcome } from '../saveRules';
import type { RunnerController } from '../screen/controller';

import { applyRunnerAnswer } from './applyAnswer';

/** The minutes row: 5 minute steps, within 5 and 180 (iOS `stepMinutes`). */
export const FINISH_MINUTES_STEP = 5;
export const FINISH_MINUTES_MIN = 5;
export const FINISH_MINUTES_MAX = 180;

/** The feelings offered, in iOS's order (`unknown` is never offered, and never sent). */
export const FINISH_FEELINGS: readonly Feeling[] = ['easy', 'ok', 'hard', 'too_hard'];

/** Where a Save stands (iOS `WorkoutRunnerModel.SaveStatus`). */
export type FinishSaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** 7.7 row 3: "Save what you did as an extra workout?" */
  | { readonly kind: 'askSaveAsExtra' }
  /** 7.7 row 4: the plan was paused or ended elsewhere. */
  | { readonly kind: 'notActive' }
  | { readonly kind: 'failed'; readonly messageKey: string };

export interface FinishSnapshot {
  readonly status: FinishSaveStatus;
  readonly minutes: number;
  readonly feeling: Feeling | null;
  /** A Save met a withdrawn consent while entitled: the consent sheet shows, and Save runs again after it. */
  readonly needsConsent: boolean;
}

export interface FinishDependencies {
  /** The session calls (the live one by default; tests and fixtures stand in). */
  readonly posting?: () => WorkoutSessionPosting;
  readonly mintKey?: () => string;
  /** The workout outbox (the live one by default). */
  readonly queue?: (options: QueueWorkoutOptions) => Promise<WorkoutQueueOutcome>;
  /** The time; the runner's own clock by default. */
  readonly clock?: () => Date;
}

const IDLE: FinishSaveStatus = { kind: 'idle' };

type Listener = () => void;

export class FinishFlow {
  private snapshot: FinishSnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly posting: () => WorkoutSessionPosting;
  private readonly mintKey: () => string;
  private readonly queue: (options: QueueWorkoutOptions) => Promise<WorkoutQueueOutcome>;
  private readonly clock: () => Date;
  /** The one `idempotency_key_reused` retry has been spent (iOS `retriedKey`). */
  private retriedKey = false;

  constructor(
    private readonly controller: RunnerController,
    dependencies: FinishDependencies = {},
  ) {
    this.posting = dependencies.posting ?? workoutSessionPosting;
    this.mintKey = dependencies.mintKey ?? newIdempotencyKey;
    this.queue = dependencies.queue ?? queueWorkoutSave;
    this.clock = dependencies.clock ?? (() => controller.time());
    this.snapshot = {
      status: IDLE,
      minutes: suggestedMinutes(controller.state, this.clock()),
      feeling: null,
      needsConsent: false,
    };
  }

  // ---------------------------------------------------------------------------
  // The store the sheet reads

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FinishSnapshot => this.snapshot;

  get status(): FinishSaveStatus {
    return this.snapshot.status;
  }

  get isSaving(): boolean {
    return this.snapshot.status.kind === 'saving';
  }

  private publish(patch: Partial<FinishSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private setStatus(status: FinishSaveStatus): void {
    this.publish({ status });
  }

  // ---------------------------------------------------------------------------
  // The sheet

  /**
   * The sheet opens (iOS `prepareFinish`): the key is minted once and written
   * down, the minutes are prefilled from the active clock, and a refusal from
   * an earlier attempt is not the answer to this one.
   */
  prepare(): void {
    if (this.controller.isClosed) return;
    if (this.controller.state.finishKey === null) {
      this.controller.apply((state) => ensureFinishKey(state, this.mintKey));
    }
    this.publish({
      minutes: suggestedMinutes(this.controller.state, this.clock()),
      ...(this.isSaving ? {} : { status: IDLE }),
    });
  }

  /** -1 or +1: five minutes less or more, within 5 and 180. */
  stepMinutes(direction: number): void {
    const next = this.snapshot.minutes + Math.sign(direction) * FINISH_MINUTES_STEP;
    this.publish({ minutes: Math.min(FINISH_MINUTES_MAX, Math.max(FINISH_MINUTES_MIN, next)) });
  }

  /** Optional: a tap picks a feeling, a second tap on it takes it back. */
  toggleFeeling(value: Feeling): void {
    this.publish({ feeling: this.snapshot.feeling === value ? null : value });
  }

  /** "Cancel" on "Save what you did as an extra workout?" */
  dismissSaveAsExtra(): void {
    if (this.snapshot.status.kind === 'askSaveAsExtra') this.setStatus(IDLE);
  }

  /** The consent sheet has been shown (granted or not). */
  consentShown(): void {
    if (this.snapshot.needsConsent) this.publish({ needsConsent: false });
  }

  /** "Finish later today" from the sheet's status block. */
  leaveLater(): void {
    this.controller.leaveLater();
  }

  // ---------------------------------------------------------------------------
  // Save

  save(): Promise<void> {
    return this.send(false);
  }

  /** "Save as extra": the same body and moment, a NEW key (7.7 row 3). */
  saveAsExtra(): Promise<void> {
    if (this.isSaving || this.controller.isClosed) return Promise.resolve();
    this.controller.apply((state) => withFinishKey(state, this.mintKey()));
    return this.send(true);
  }

  private async send(asExtra: boolean): Promise<void> {
    if (this.isSaving || this.controller.isClosed) return;
    // The moment and the key are written down before the request goes out.
    const now = this.clock();
    const state = this.controller.apply((current) => ensureFinishKey(withCompletedAt(current, now), this.mintKey));
    const epoch = runnerWipeEpoch();
    this.setStatus({ kind: 'saving' });
    const body = runnerDoneBody(state, { minutes: this.snapshot.minutes, feeling: this.snapshot.feeling, asExtra });
    const key = state.finishKey ?? this.mintKey();
    try {
      const response = await this.posting().done(state.sessionId, body, key);
      // A sign-out wiped the workout meanwhile: the runner has closed, and nothing of it is applied.
      if (this.controller.isClosed) return;
      this.track(asExtra ? 'extra' : 'saved');
      this.controller.endRunner();
      this.setStatus(IDLE);
      applyRunnerAnswer(response);
      this.controller.close({ kind: 'saved', response });
    } catch (error) {
      if (this.controller.isClosed) return;
      const failure = readRunnerFailure(error);
      const outcome = runnerSaveOutcome(failure.kind, { isExtra: asExtra, retriedKey: this.retriedKey });
      switch (outcome.kind) {
        case 'saved':
          this.setStatus(IDLE);
          return;
        case 'queueOffline':
          await this.queueOffline(body, key, epoch);
          return;
        case 'askSaveAsExtra':
          this.setStatus({ kind: 'askSaveAsExtra' });
          return;
        case 'notActive':
          this.setStatus({ kind: 'notActive' });
          this.track('not_active');
          return;
        case 'retryWithNewKey':
          this.retriedKey = true;
          this.controller.apply((current) => withFinishKey(current, this.mintKey()));
          this.setStatus(IDLE);
          await this.send(asExtra);
          return;
        case 'gate':
          // The file is KEPT (7.7 row 5): the gate shows, and a member who
          // fixes their membership can still save it from Resume.
          if (failure.apiError) useHealthStore.getState().handle(failure.apiError, { foreground: true });
          this.setStatus(IDLE);
          this.controller.close({ kind: 'needsReload' });
          return;
        case 'consent': {
          const handled = failure.apiError
            ? useHealthStore.getState().handle(failure.apiError, { foreground: true })
            : 'other';
          this.setStatus(IDLE);
          if (handled === 'presentConsent') this.publish({ needsConsent: true });
          else this.controller.close({ kind: 'needsReload' });
          return;
        }
        case 'keep':
          this.setStatus({ kind: 'failed', messageKey: outcome.messageKey });
          return;
        case 'silent':
          this.setStatus(IDLE);
          return;
      }
    }
  }

  /**
   * No network: into the outbox, and only once it is on disk does the runner
   * file go (a finished workout is never only in memory).
   */
  private async queueOffline(body: WorkoutDoneBody, key: string, since: number): Promise<void> {
    const outcome = await this.queue({
      sessionId: this.controller.state.sessionId,
      body,
      key,
      profileId: this.controller.profileId,
      since,
    });
    if (this.controller.isClosed) return;
    switch (outcome) {
      case 'queued':
        this.track('outbox');
        this.controller.endRunner();
        this.setStatus(IDLE);
        useHealthStore.getState().setToast('health.saved_offline');
        this.controller.close({ kind: 'queued' });
        return;
      case 'full':
        this.setStatus({ kind: 'failed', messageKey: 'runner.err.outbox_full' });
        return;
      case 'notSaved':
        this.setStatus({ kind: 'failed', messageKey: 'runner.err.not_saved' });
        return;
      case 'discarded':
        // The local wipe took the workout; the runner is told to close.
        this.setStatus(IDLE);
        return;
    }
  }

  private track(outcome: WorkoutFinishedOutcome): void {
    RunnerAnalytics.finished(outcome, this.snapshot.feeling !== null);
  }
}

const flows = new WeakMap<RunnerController, FinishFlow>();

/** The finish flow of this runner (one per runner, made on first use). */
export function finishFlowFor(controller: RunnerController, dependencies?: FinishDependencies): FinishFlow {
  let flow = flows.get(controller);
  if (!flow) {
    flow = new FinishFlow(controller, dependencies);
    flows.set(controller, flow);
  }
  return flow;
}
