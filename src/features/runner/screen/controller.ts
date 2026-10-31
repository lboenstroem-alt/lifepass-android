/**
 * The workout runner's view model: the Android port of iOS
 * `WorkoutRunnerModel` (Views/Workout/WorkoutRunnerView.swift), less what
 * RUN-3 adds (the finish sheet's Save, Skip this workout, swap for the rest
 * of the plan: see `apply`, `endRunner` and `close` below for its hooks).
 *
 * It holds the in-progress workout (RUN-1's pure `RunnerState`) and the
 * clock the screen reads, runs every rule through the model with the time,
 * writes `runner.json` after every change, and owns everything that outlives
 * a single render: the rest alert, the keep-awake, the cues and TalkBack's
 * announcements.
 *
 * THE TIME RULE. Every countdown is a date in the state. The screen calls
 * `tick(now)` twice a second (and on the way back to the foreground); a
 * timed set that reached zero ticks itself AT its end, and a rest that ran
 * out ends, whenever the tick next comes. A JS timer that stopped in the
 * background, or a process that was killed, therefore never changes a
 * result: it only changes when the screen hears of it.
 *
 * WHAT IS SAID AND FELT, AND WHEN. A rest that ends on screen gives the
 * success cue and "Rest is over", but only when noticed within 5 seconds of
 * its end (a rest that ended while the phone was locked was announced by its
 * notification). The changeover of a hold done each side gives the medium
 * cue and "Switch sides" once per set, on screen, and only while fresh. In
 * the background nothing is said or felt: the notification is the message.
 *
 * Plain TypeScript with a subscribe/snapshot pair, so the iOS view-model
 * tests run against it without React, and the screen reads it through
 * `useRunnerSnapshot` (./useRunner.ts).
 */
import { translate, type Lang } from '../../../i18n';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { todayServerDay } from '../../../i18n/format';
import type { SessionActionResponse, SessionView } from '../../../health/models';
import { RunnerAnalytics } from '../model/analytics';
import { doneCount } from '../model/exercise';
import {
  activeSeconds,
  adjustRest as adjustRestRule,
  advance as advanceRule,
  anySetDone,
  completeNextSet as completeNextSetRule,
  currentExercise,
  finishTimerIfDue,
  isResting as isRestingRule,
  openRunnerState,
  pauseClock,
  primaryAction,
  restRemaining as restRemainingRule,
  resumeClock,
  setKg as setKgRule,
  setValue as setValueRule,
  skipCurrentExercise,
  skipRest as skipRestRule,
  startNextTimer as startNextTimerRule,
  startTimer,
  stepKg as stepKgRule,
  stepValue as stepValueRule,
  stopTimer,
  stopwatchRunning,
  swapOptions as swapOptionsRule,
  tick as tickRule,
  timerRemaining,
  toggleStopwatch as toggleStopwatchRule,
  undoSkip as undoSkipRule,
  untick,
} from '../model/state';
import { switchStartsAt, timerPhase as phaseOf } from '../model/timer';
import type {
  RunnerEntry,
  RunnerExercise,
  RunnerSkipUndo,
  RunnerState,
  RunnerSwapOption,
  RunnerTickOutcome,
  RunnerTimerPhase,
} from '../model/types';
import { deleteRunner, persistRunner } from '../persistence/runnerStore';
import { runnerWipeEpoch, wipedSince } from '../persistence/fence';
import { RunnerProgressIndex } from '../persistence/progressIndex';
import { liveRestAlerts, type RunnerRestAlerting } from '../restNotification';
import { liveRunnerCues, type RunnerCues } from '../timer/cues';
import { keepRunnerAwake, type RunnerKeepAwake } from '../timer/keepAwake';

/** How the runner was closed, for Plan (iOS `RunnerCloseResult`). */
export type RunnerCloseResult =
  /** Saved (or saved as an extra): the response replaces day, week, upcoming. RUN-3. */
  | { readonly kind: 'saved'; readonly response: SessionActionResponse }
  /** Skipped with a reason. RUN-3. */
  | { readonly kind: 'skipped'; readonly response: SessionActionResponse }
  /** Saved on the phone; the outbox sends it. RUN-3. */
  | { readonly kind: 'queued' }
  /** "Finish later today": `runner.json` kept, Plan shows Resume. */
  | { readonly kind: 'later' }
  /** Discarded, or the local wipe took it. */
  | { readonly kind: 'discarded' }
  /** A refusal that changes what Plan shows (the gate, consent, a reload). RUN-3. */
  | { readonly kind: 'needsReload' };

/** How late a rest's end (or a changeover) may be noticed and still be said (iOS `freshRestEnd`). */
export const FRESH_CUE_SECONDS = 5;

/** How long "Exercise skipped" and its Undo stay (iOS 7.6). */
export const SKIP_UNDO_MS = 4000;

/** What the screen renders from: replaced (never mutated) on every change. */
export interface RunnerSnapshot {
  readonly state: RunnerState;
  /** The clock the page shows, published once per displayed second. */
  readonly now: Date;
  /** Undo for the last skipped exercise, while its toast shows. */
  readonly skipUndo: RunnerSkipUndo | null;
  /** What the toast says: the exercise, or only its last sets. */
  readonly skipToastKey: string;
  /** Bumped by every skip, so the toast announces each one. */
  readonly skipToastId: number;
}

export interface RunnerControllerOptions {
  readonly session: SessionView;
  /** The member's saved `runner.json`, when there is one (any session: only this session's is resumed). */
  readonly restored: RunnerState | null;
  readonly profileId: string;
  readonly language: Lang;
  readonly entry: RunnerEntry;
  readonly alerts?: RunnerRestAlerting;
  readonly cues?: RunnerCues;
  readonly keepAwake?: RunnerKeepAwake;
  /** The time; tests pass their own. */
  readonly clock?: () => Date;
  /** The server's calendar day (Reykjavík); defaults to today's. */
  readonly today?: string;
  /**
   * The wipe epoch captured BEFORE `restored` was read (`runnerWipeEpoch()`).
   * The screen passes it, so a wipe that lands while runner.json is read
   * fences this runner too (it was built from what the wipe discarded).
   * Defaults to the epoch now.
   */
  readonly wipeEpoch?: number;
}

type Listener = () => void;

export class RunnerController {
  readonly profileId: string;
  /** `resume` when the saved workout of this session was opened, else where the runner was opened from. */
  readonly entry: RunnerEntry;
  language: Lang;

  /** Bumped when a set is ticked (the light cue). */
  tickCount = 0;
  /** Bumped when a rest runs out on screen (the success cue). */
  restFinishedCount = 0;
  /** Bumped at the changeover of a hold done each side (the medium cue). */
  switchSidesCount = 0;

  /** Closes the screen. Set by the screen; RUN-3's sheets close through `close`. */
  onClose: ((result: RunnerCloseResult) => void) | null = null;

  private snapshot: RunnerSnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly alerts: RunnerRestAlerting;
  private readonly cues: RunnerCues;
  private readonly keepAwake: RunnerKeepAwake;
  private readonly clock: () => Date;
  /** The wipe epoch this runner opened in: after a wipe nothing more is written. */
  private readonly wipeEpoch: number;
  private isForeground = true;
  private didAppear = false;
  private closed = false;
  /** The timer (by its start) whose changeover was already cued, so the cue fires once per set. */
  private switchCuedFor: number | null = null;
  private skipUndoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RunnerControllerOptions) {
    this.profileId = options.profileId;
    this.language = options.language;
    this.alerts = options.alerts ?? liveRestAlerts;
    this.cues = options.cues ?? liveRunnerCues;
    this.keepAwake = options.keepAwake ?? keepRunnerAwake;
    this.clock = options.clock ?? (() => new Date());
    this.wipeEpoch = options.wipeEpoch ?? runnerWipeEpoch();
    const now = this.clock();
    const opened = openRunnerState({
      session: options.session,
      restored: options.restored,
      entry: options.entry,
      now,
      today: options.today ?? todayServerDay(now),
    });
    this.entry = opened.entry;
    this.snapshot = { state: opened.state, now, skipUndo: null, skipToastKey: 'runner.skipped_toast', skipToastId: 0 };
  }

  // ---------------------------------------------------------------------------
  // The store the screen reads

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RunnerSnapshot => this.snapshot;

  get state(): RunnerState {
    return this.snapshot.state;
  }

  get now(): Date {
    return this.snapshot.now;
  }

  private publish(patch: Partial<RunnerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Replaces the state (and the clock the page shows, when given). */
  private setState(state: RunnerState, now?: Date): void {
    this.publish(now ? { state, now } : { state });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  /** The screen is up: written down at once, counted once, and caught up with the time. */
  appeared(): void {
    if (this.closed) return;
    this.persist();
    if (this.didAppear) return;
    this.didAppear = true;
    RunnerAnalytics.started(this.state.session.kind, this.entry);
    // A relaunch may land after the rest ran out.
    this.tick(this.clock());
    this.updateKeepAwake();
  }

  /** The screen went away (closed, or removed under the runner): nothing it started may outlive it. */
  disappeared(): void {
    this.keepAwake(false);
    this.alerts.cancel();
    this.clearSkipUndoTimer();
  }

  /**
   * The clock. Called twice a second while the screen is up, for as long as
   * the process runs in the background too.
   */
  tick(now: Date): void {
    if (this.closed) return;
    // Publish the clock once per displayed second, not on every wake.
    if (Math.floor(now.getTime() / 1000) !== Math.floor(this.now.getTime() / 1000)) {
      this.publish({ now });
    }
    let changed = false;
    this.cueSwitchSidesIfDue(now);
    const finished = finishTimerIfDue(this.state, now);
    if (finished.outcome) {
      changed = true;
      this.setState(finished.state);
      if (this.isForeground) this.setTicked();
      if (finished.outcome.kind === 'restStarted') this.restStarted();
    }
    const restEndsAt = this.state.restEndsAt;
    if (restEndsAt && restEndsAt.getTime() <= now.getTime()) {
      this.setState(skipRestRule(this.state));
      changed = true;
      if (this.isForeground) {
        this.restFinished((now.getTime() - restEndsAt.getTime()) / 1000 < FRESH_CUE_SECONDS);
      }
      // IN THE BACKGROUND THE ALERT IS THE MESSAGE. The process is still
      // alive for a while after the phone locks, and this is the moment the
      // rest notification is shown: cancelling it here would withdraw it
      // within milliseconds. The state is cleared and nothing else; the
      // return to the app removes the alert (`appStateChanged`).
    }
    // A running clock is written down now and then, so a process that dies
    // does not count the hours after it.
    if (!changed && this.state.clockRunningSince && now.getTime() - this.state.lastSeenAt.getTime() >= 30_000) {
      changed = true;
    }
    if (changed) this.persist();
    this.updateKeepAwake(now);
  }

  /** `tick` at the controller's own time (the screen's half-second timer). */
  tickNow(): void {
    this.tick(this.clock());
  }

  /** The app came to the foreground (`true`) or left it. */
  appStateChanged(isActive: boolean): void {
    // Two reports for one departure (inactive, then background) are one.
    if (isActive === this.isForeground || this.closed) return;
    this.isForeground = isActive;
    const now = this.clock();
    if (isActive) {
      this.alerts.cancel();
      this.setState(resumeClock(this.state, now));
      this.persist();
      this.tick(now);
    } else {
      this.setState(pauseClock(this.state, now, true));
      this.persist();
      const endsAt = this.state.restEndsAt;
      if (endsAt && endsAt.getTime() > now.getTime()) this.alerts.schedule(endsAt, this.language);
    }
  }

  // ---------------------------------------------------------------------------
  // Reading for the screen

  get current(): RunnerExercise | null {
    return currentExercise(this.state);
  }

  get isResting(): boolean {
    return isRestingRule(this.state, this.now);
  }

  get restRemaining(): number {
    return restRemainingRule(this.state, this.now) ?? 0;
  }

  /** What is left of the rest, 1 at its start, for the ring. */
  get restFraction(): number {
    const total = this.state.restTotalSeconds;
    if (!total || total <= 0) return 0;
    return Math.min(1, Math.max(0, this.restRemaining / total));
  }

  /** ACTIVE time: stopped while the member is away or chose "later". */
  get elapsedSeconds(): number {
    return activeSeconds(this.state, this.now);
  }

  timerRemaining(exercise: number, set: number): number | null {
    const timer = this.state.timer;
    if (!timer || timer.exercise !== exercise || timer.set !== set) return null;
    return timerRemaining(this.state, this.now);
  }

  /** Where the countdown of (exercise, set) is, or null when it is not counting. */
  timerPhase(exercise: number, set: number): RunnerTimerPhase | null {
    const timer = this.state.timer;
    if (!timer || timer.exercise !== exercise || timer.set !== set) return null;
    const phase = phaseOf(timer, this.now);
    return phase.kind === 'ended' ? null : phase;
  }

  /** Whole seconds the stopwatch of `exercise` has run, or null when it is not running. */
  stopwatchSeconds(exercise: number): number | null {
    const started = this.state.exercises[exercise]?.stopwatchStartedAt;
    if (!started) return null;
    return Math.trunc(Math.max(0, (this.now.getTime() - started.getTime()) / 1000));
  }

  /** The rest for TalkBack, in 15 second steps, so it is not read a new number every second (7.12). */
  get restAccessibilityValue(): string {
    const bucket = Math.ceil(this.restRemaining / 15) * 15;
    return translate('a11y.runner.rest_left', this.language, {
      time: RunnerFormat.spokenDuration(bucket, this.language),
    });
  }

  /** Skipping the whole session is offered only before any set is done (RUN-3's sheet; the Leave dialog's row). */
  get canSkipWorkout(): boolean {
    return this.state.session.canSkip === true && !anySetDone(this.state);
  }

  swapOptions(): RunnerSwapOption[] {
    return swapOptionsRule(this.state, this.state.index);
  }

  // ---------------------------------------------------------------------------
  // Set actions

  completeNextSet(): void {
    if (this.isRestingAt(this.clock())) return;
    const result = completeNextSetRule(this.state, this.clock());
    this.afterTick(result.state, result.outcome);
  }

  /** The big button on a timed set: start its countdown (7.3). */
  startNextTimer(): void {
    const now = this.clock();
    if (this.isRestingAt(now)) return;
    this.setState(startNextTimerRule(this.state, now), now);
    this.persist();
    this.updateKeepAwake(now);
  }

  /**
   * The bottom button, whatever it says. `openFinish` is the finish sheet
   * (RUN-3), opened by the screen.
   */
  performPrimary(openFinish: () => void): void {
    switch (primaryAction(this.state).kind) {
      case 'startTimer':
        this.startNextTimer();
        return;
      case 'completeSet':
        this.completeNextSet();
        return;
      case 'next':
        this.advance();
        return;
      case 'finish':
        openFinish();
        return;
    }
  }

  /** The check circle: tick the set, or untick one ticked by mistake. */
  toggleSet(exercise: number, set: number): void {
    const target = this.state.exercises[exercise]?.sets[set];
    if (!target) return;
    if (target.done) {
      this.setState(untick(this.state, exercise, set));
      this.persist();
      return;
    }
    const result = tickRule(this.state, exercise, set, this.clock());
    this.afterTick(result.state, result.outcome);
  }

  private afterTick(state: RunnerState, outcome: RunnerTickOutcome | null): void {
    if (!outcome) return;
    const now = this.clock();
    this.setState(state, now);
    this.setTicked();
    if (outcome.kind === 'restStarted') this.restStarted();
    this.persist();
    this.updateKeepAwake(now);
  }

  stepValue(exercise: number, set: number, direction: number): void {
    this.setState(stepValueRule(this.state, exercise, set, direction));
    this.persist();
  }

  setValue(exercise: number, set: number, value: number): void {
    this.setState(setValueRule(this.state, exercise, set, value));
    this.persist();
  }

  stepKg(exercise: number, set: number, direction: number): void {
    this.setState(stepKgRule(this.state, exercise, set, direction));
    this.persist();
  }

  setKg(exercise: number, set: number, kg: number | null): void {
    this.setState(setKgRule(this.state, exercise, set, kg));
    this.persist();
  }

  /** The capsule of a timed set: start its countdown, or stop it. */
  toggleTimer(exercise: number, set: number): void {
    const now = this.clock();
    const timer = this.state.timer;
    const counting = timer !== null && timer.exercise === exercise && timer.set === set;
    this.setState(counting ? stopTimer(this.state) : startTimer(this.state, exercise, set, now), now);
    this.persist();
    this.updateKeepAwake(now);
  }

  toggleStopwatch(exercise: number): void {
    const now = this.clock();
    this.setState(toggleStopwatchRule(this.state, exercise, now), now);
    this.persist();
    this.updateKeepAwake(now);
  }

  // ---------------------------------------------------------------------------
  // Rest

  /** -15 or +15 (`REST_STEP_SECONDS`). Pushed to zero, the rest ends without a cue. */
  adjustRest(by: number): void {
    const now = this.clock();
    this.setState(adjustRestRule(this.state, by, now), now);
    if (this.state.restEndsAt === null) this.restFinished(false);
    this.persist();
    this.updateKeepAwake(now);
  }

  skipRest(): void {
    if (this.state.restEndsAt === null) return;
    this.setState(skipRestRule(this.state));
    this.restFinished(false);
    this.persist();
    this.updateKeepAwake();
  }

  private isRestingAt(now: Date): boolean {
    return isRestingRule(this.state, now);
  }

  private restStarted(): void {
    const endsAt = this.state.restEndsAt;
    if (!this.isForeground && endsAt) this.alerts.schedule(endsAt, this.language);
  }

  /** The alert goes; on screen and fresh, the success cue and "Rest is over" mark the end (7.4). */
  private restFinished(announce: boolean): void {
    this.alerts.cancel();
    if (!announce) return;
    this.restFinishedCount += 1;
    this.cues.restFinished();
    this.alerts.announce(translate('runner.rest_done', this.language));
  }

  private setTicked(): void {
    this.tickCount += 1;
    this.cues.setTicked();
  }

  /**
   * The changeover of a hold done each side: once per set, the medium cue
   * and "Switch sides" for TalkBack, in the foreground and only while it is
   * fresh (a phone unlocked long after the changeover is not told to switch
   * sides it has already switched).
   */
  private cueSwitchSidesIfDue(now: Date): void {
    const timer = this.state.timer;
    const switchAt = timer ? switchStartsAt(timer) : null;
    if (!timer || !switchAt || now.getTime() < switchAt.getTime()) return;
    if (this.switchCuedFor === timer.startedAt.getTime()) return;
    this.switchCuedFor = timer.startedAt.getTime();
    if (!this.isForeground) return;
    if (now.getTime() >= timer.endsAt.getTime()) return;
    if ((now.getTime() - switchAt.getTime()) / 1000 >= FRESH_CUE_SECONDS) return;
    this.switchSidesCount += 1;
    this.cues.switchSides();
    this.alerts.announce(translate('runner.switch_sides', this.language));
  }

  /** Awake only while something counts: a rest, a timed set, a stopwatch. */
  private updateKeepAwake(now: Date = this.now): void {
    if (this.closed) return;
    this.keepAwake(
      isRestingRule(this.state, now) || timerRemaining(this.state, now) !== null || stopwatchRunning(this.state),
    );
  }

  // ---------------------------------------------------------------------------
  // Moving through the session

  /** Next exercise. A rest that is still running keeps running. */
  advance(): void {
    this.setState(advanceRule(this.state));
    this.persist();
  }

  /**
   * "Skip exercise" (nothing done) or "Skip remaining sets" (a set done): the
   * block is closed, the runner moves on, and "Exercise skipped" with Undo
   * shows for four seconds (7.6).
   */
  skipExercise(): void {
    const current = this.current;
    if (!current) return;
    const partial = doneCount(current) > 0;
    const { state, undo } = skipCurrentExercise(this.state);
    if (!undo) return;
    this.clearSkipUndoTimer();
    this.publish({
      state,
      skipUndo: undo,
      skipToastKey: partial ? 'runner.skipped_rest_toast' : 'runner.skipped_toast',
      skipToastId: this.snapshot.skipToastId + 1,
    });
    RunnerAnalytics.exerciseSkipped();
    this.persist();
    this.updateKeepAwake();
    this.skipUndoTimer = setTimeout(() => {
      this.skipUndoTimer = null;
      this.publish({ skipUndo: null });
    }, SKIP_UNDO_MS);
  }

  undoSkip(): void {
    const undo = this.snapshot.skipUndo;
    if (!undo) return;
    this.clearSkipUndoTimer();
    this.publish({ state: undoSkipRule(this.state, undo), skipUndo: null });
    this.persist();
  }

  private clearSkipUndoTimer(): void {
    if (this.skipUndoTimer) clearTimeout(this.skipUndoTimer);
    this.skipUndoTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Leave (7.8)

  /**
   * "Finish later today": the clock stops and the return credits nothing
   * ("later" is not workout time); the file is kept, so Plan shows Resume.
   */
  leaveLater(): void {
    if (this.closed) return;
    this.setState(pauseClock(this.state, this.clock(), false));
    this.persist();
    RunnerAnalytics.left('later');
    this.alerts.cancel();
    this.close({ kind: 'later' });
  }

  /** "Discard workout": the file goes, and everything the runner started stops. */
  discard(): void {
    if (this.closed) return;
    RunnerAnalytics.left('discard');
    this.endRunner();
    this.close({ kind: 'discarded' });
  }

  /**
   * The local wipe ran (a sign-out, a withdrawal, a verified minor): nothing
   * of this workout may survive it, the file included, which the wipe
   * already deleted. Nothing is written back.
   */
  wiped(): void {
    if (this.closed) return;
    this.alerts.cancel();
    this.keepAwake(false);
    RunnerProgressIndex.clear();
    this.close({ kind: 'discarded' });
  }

  // ---------------------------------------------------------------------------
  // For RUN-3's swap, skip-workout and finish sheets

  /** The runner's clock (tests set their own): the finish sheet's minutes and the Save's moment. */
  time(): Date {
    return this.clock();
  }

  /**
   * Applies a model change made outside this class (a swap, the Save key and
   * moment), writes it down and keeps the keep-awake right. Returns the new
   * state.
   */
  apply(change: (state: RunnerState, now: Date) => RunnerState): RunnerState {
    const now = this.clock();
    this.setState(change(this.state, now), now);
    this.persist();
    this.updateKeepAwake(now);
    return this.state;
  }

  /**
   * Deletes the file and stops everything that outlives the screen (iOS
   * `endRunner`). A Save or a Skip that went through, or was queued, calls it
   * before `close`.
   */
  endRunner(): void {
    void deleteRunner(this.profileId);
    this.alerts.cancel();
    this.keepAwake(false);
  }

  /**
   * Closes the screen with `result`, once. Subscribers hear it (`isClosed`),
   * so an open sheet slides out with the runner rather than staying over the
   * screen under it while the runner leaves.
   */
  close(result: RunnerCloseResult): void {
    if (this.closed) return;
    this.closed = true;
    this.clearSkipUndoTimer();
    this.keepAwake(false);
    this.publish({});
    this.onClose?.(result);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * A local wipe ran since this runner's workout was read: it must close
   * (`wiped`). The screen asks once it listens for wipes, for one that
   * landed between the open and its subscription.
   */
  get wasWiped(): boolean {
    return wipedSince(this.wipeEpoch);
  }

  // ---------------------------------------------------------------------------
  // Persistence

  /** Writes `runner.json` (a running clock stamped as seen now). Nothing after a close or a wipe. */
  private persist(): void {
    if (this.closed) return;
    const stamped = persistRunner(this.state, this.profileId, this.clock(), { since: this.wipeEpoch });
    if (stamped !== this.state) this.snapshot = { ...this.snapshot, state: stamped };
  }
}
